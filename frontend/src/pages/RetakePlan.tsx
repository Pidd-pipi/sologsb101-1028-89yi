/** /retakes 补录计划与结构版本导出：本地库版本查看与 JSON 导入导出 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import { DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import StatBadge from '@/components/common/StatBadge';
import EmptyPanel from '@/components/common/EmptyPanel';
import TakeBadge from '@/components/common/TakeBadge';
import { useIdbTable } from '@/hooks/useIdbTable';
import { useProjectStore } from '@/stores/projectStore';
import {
  db,
  countAll,
  exportSnapshot,
  importSnapshot,
  resetDatabase,
  updateRetake,
  completeRetake,
  putRetake,
  removeRetake,
  DB_NAME,
  DB_SCHEMA_VERSION,
  type ProjectRow,
  type RetakeRow,
  type SessionRow,
  type SongRow,
  type TakeRow
} from '@/utils/db';
import { RETAKE_STATES, createEmptyRetake, type Retake } from '@/types/retake';
import { buildRow } from '@/hooks/useIdbTable';
import { buildSessionSheet, downloadJson, parseSheet, serializeSheet, type SessionSheet } from '@/utils/export';
import { formatDuration, totalDuration } from '@/utils/timecode';

export default function RetakePlan() {
  const retakes = useIdbTable<RetakeRow>(db.retakes);
  const songs = useIdbTable<SongRow>(db.songs);
  const projects = useIdbTable<ProjectRow>(db.projects);
  const sessions = useIdbTable<SessionRow>(db.sessions);
  const takes = useIdbTable<TakeRow>(db.takes);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RetakeRow | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sheet, setSheet] = useState<SessionSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<Omit<Retake, 'id'>>();

  useEffect(() => {
    void (async () => {
      setCounts(await countAll());
    })();
  }, [retakes.length]);

  const songOf = (songId: string): SongRow | null => songs.find((item) => item.id === songId) ?? null;
  const songLabel = (songId: string): string => {
    const song = songOf(songId);
    if (!song) return '曲目已删除';
    const project = projects.find((item) => item.id === song.projectId);
    return `${song.title}${project ? ` · ${project.name}` : ''}`;
  };

  const scopedRetakes = currentProjectId
    ? retakes.filter((retake) => songOf(retake.songId)?.projectId === currentProjectId)
    : retakes;

  /** 由有问题的 Take 生成补录建议 */
  const problemTakes = useMemo(
    () =>
      takes.filter(
        (take) =>
          take.issues.some((issue) => issue !== '无') ||
          take.grade === '废' ||
          take.grade === '待定'
      ),
    [takes]
  );

  const totals = useMemo(() => {
    const pending = scopedRetakes.filter((item) => item.state !== '已完成').length;
    const openTakeDuration = totalDuration(
      problemTakes.map((take) => ({ startTc: take.startTc, endTc: take.endTc }))
    );
    return {
      total: scopedRetakes.length,
      pending,
      done: scopedRetakes.filter((item) => item.state === '已完成').length,
      problemTakes: problemTakes.length,
      openDurationText: formatDuration(openTakeDuration)
    };
  }, [scopedRetakes, problemTakes]);

  async function submit(): Promise<void> {
    const values = await form.validateFields();
    if (editing) {
      await updateRetake(editing.id, values);
      message.success('补录条目已更新');
    } else {
      await putRetake(buildRow(values, 'retake'));
      message.success('补录条目已建立');
    }
    setDialogOpen(false);
    setEditing(null);
    form.resetFields();
  }

  /** 由问题 Take 直接生成补录条目 */
  async function createFromTake(take: TakeRow): Promise<void> {
    const session = sessions.find((item) => item.id === take.sessionId);
    if (!session) {
      message.error('该条次所属场次已删除，无法生成补录');
      return;
    }
    const reasons = take.issues.filter((issue) => issue !== '无').join('、');
    await putRetake(
      buildRow(
        {
          songId: session.songId,
          reason: `${take.takeNo}（${take.startTc} → ${take.endTc}）${reasons ? `问题：${reasons}` : '评级不理想'}，需补录`,
          planDate: new Date().toISOString().slice(0, 10),
          state: '待安排'
        } as Omit<Retake, 'id'>,
        'retake'
      )
    );
    message.success('已生成补录条目');
  }

  async function exportSheet(): Promise<void> {
    const current = await buildSessionSheet();
    setSheet(current);
    downloadJson(`场次记录表-${current.exportedAt.slice(0, 10)}.json`, serializeSheet(current));
    message.success('场次记录表已下载');
  }

  async function exportLibrary(): Promise<void> {
    const snapshot = await exportSnapshot();
    downloadJson(`gbstudiotake-备份-${snapshot.exportedAt.slice(0, 10)}.json`, JSON.stringify(snapshot, null, 2));
    message.success('本地库已导出为 JSON');
  }

  const [importText, setImportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);

  async function doImport(): Promise<void> {
    setError(null);
    try {
      const parsed = parseSheet(importText) as unknown as Awaited<ReturnType<typeof exportSnapshot>>;
      if (!Array.isArray((parsed as unknown as { songs?: unknown[] }).songs)) {
        throw new Error('缺少 songs 数组字段，不是本应用的备份文件');
      }
      await importSnapshot(parsed);
      setCounts(await countAll());
      setImportOpen(false);
      setImportText('');
      message.success('备份已导入');
    } catch (importError) {
      const text = importError instanceof Error ? importError.message : '导入失败';
      setError(text);
      message.error(`导入失败：${text}`);
    }
  }

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h2 className="page__title">补录计划与结构版本导出</h2>
          <p className="page__subtitle">
            本地库 {DB_NAME}（结构版本 v{DB_SCHEMA_VERSION}）· 补录完成后自动联动曲目录制状态。
          </p>
        </div>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={exportLibrary}>
            导出整库备份
          </Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={exportSheet}>
            导出场次记录表
          </Button>
          <Button
            icon={<PlusOutlined />}
            disabled={songs.length === 0}
            onClick={() => {
              setEditing(null);
              form.setFieldsValue({ ...createEmptyRetake(), songId: songs[0]?.id ?? '' });
              setDialogOpen(true);
            }}
          >
            新建补录
          </Button>
        </Space>
      </div>

      <div className="badge-row">
        <StatBadge label="补录条目" value={totals.total} suffix="条" tone="primary" icon="files" />
        <StatBadge label="待处理" value={totals.pending} suffix="条" tone="warning" icon="warning" />
        <StatBadge label="已完成" value={totals.done} suffix="条" tone="success" icon="grid" />
        <StatBadge label="问题 Take" value={totals.problemTakes} suffix="条" tone="danger" icon="histogram" />
        <StatBadge label="待补录时长" value={totals.openDurationText} tone="info" icon="trend" />
      </div>

      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} /> : null}

      <Row gutter={16}>
        <Col xs={24} xl={16}>
          <Card title={`补录清单（${scopedRetakes.length}）`}>
            {scopedRetakes.length === 0 ? (
              <EmptyPanel
                title="暂无补录计划"
                description="从问题 Take 直接生成补录条目，或手工新建一条补录计划。"
                showCreate={songs.length > 0}
                createText="新建补录"
                onCreate={() => {
                  setEditing(null);
                  form.setFieldsValue({ ...createEmptyRetake(), songId: songs[0]?.id ?? '' });
                  setDialogOpen(true);
                }}
              />
            ) : (
              <Table<RetakeRow>
                rowKey="id"
                dataSource={scopedRetakes}
                pagination={false}
                columns={[
                  { title: '曲目', minWidth: 180, render: (_, row) => songLabel(row.songId) },
                  { title: '补录原因', dataIndex: 'reason', minWidth: 240 },
                  { title: '计划日期', dataIndex: 'planDate', width: 120 },
                  {
                    title: '状态',
                    dataIndex: 'state',
                    width: 110,
                    render: (value: string) => (
                      <Tag color={value === '已完成' ? 'green' : value === '已排期' ? 'blue' : 'orange'}>{value}</Tag>
                    )
                  },
                  {
                    title: '操作',
                    width: 210,
                    render: (_, row) => (
                      <Space>
                        <Select
                          size="small"
                          style={{ width: 100 }}
                          value={row.state}
                          options={RETAKE_STATES.map((item) => ({ label: item, value: item }))}
                          onChange={async (value) => {
                            await updateRetake(row.id, { state: value as Retake['state'] });
                            message.success('状态已更新');
                          }}
                        />
                        {row.state !== '已完成' ? (
                          <Button
                            type="link"
                            size="small"
                            onClick={async () => {
                              await completeRetake(row.id);
                              message.success('补录已完成，曲目状态已联动');
                            }}
                          >
                            完成
                          </Button>
                        ) : null}
                        <Button
                          type="link"
                          size="small"
                          onClick={() => {
                            setEditing(row);
                            form.setFieldsValue({
                              songId: row.songId,
                              reason: row.reason,
                              planDate: row.planDate,
                              state: row.state
                            });
                            setDialogOpen(true);
                          }}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="删除该补录条目？"
                          onConfirm={async () => {
                            await removeRetake(row.id);
                            message.success('补录条目已删除');
                          }}
                        >
                          <Button type="link" size="small" danger>
                            删除
                          </Button>
                        </Popconfirm>
                      </Space>
                    )
                  }
                ]}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title="由问题 Take 生成补录">
              {problemTakes.length === 0 ? (
                <Typography.Text type="secondary">当前没有评级不理想或带问题标签的条次。</Typography.Text>
              ) : (
                <Table<TakeRow>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={problemTakes}
                  columns={[
                    {
                      title: '条次',
                      render: (_, row) => (
                        <Space direction="vertical" size={2}>
                          <span>{row.takeNo}</span>
                          <TakeBadge grade={row.grade} issues={row.issues} />
                        </Space>
                      )
                    },
                    {
                      title: '生成',
                      width: 80,
                      render: (_, row) => (
                        <Button type="link" size="small" onClick={() => void createFromTake(row)}>
                          补录
                        </Button>
                      )
                    }
                  ]}
                />
              )}
            </Card>

            <Card title="本地结构版本">
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="库名">{DB_NAME}</Descriptions.Item>
                <Descriptions.Item label="结构版本">v{DB_SCHEMA_VERSION}</Descriptions.Item>
                <Descriptions.Item label="项目 / 曲目">
                  {counts.projects ?? 0} / {counts.songs ?? 0}
                </Descriptions.Item>
                <Descriptions.Item label="场次 / Take">
                  {counts.sessions ?? 0} / {counts.takes ?? 0}
                </Descriptions.Item>
                <Descriptions.Item label="优选 / 补录">
                  {counts.picks ?? 0} / {counts.retakes ?? 0}
                </Descriptions.Item>
                <Descriptions.Item label="记录表生成时间">
                  {sheet ? sheet.exportedAt.slice(0, 19).replace('T', ' ') : '—'}
                </Descriptions.Item>
              </Descriptions>
              <Space style={{ marginTop: 12 }} wrap>
                <Button
                  icon={<UploadOutlined />}
                  onClick={() => {
                    setError(null);
                    setImportOpen(true);
                  }}
                >
                  导入备份
                </Button>
                <Button
                  danger
                  onClick={async () => {
                    await resetDatabase();
                    setCounts(await countAll());
                    message.success('已重置为演示数据');
                  }}
                >
                  重置演示数据
                </Button>
                <Button
                  onClick={async () => {
                    setSheet(await buildSessionSheet());
                    message.success('已重新生成场次记录表');
                  }}
                >
                  刷新记录表
                </Button>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>

      <Modal
        open={dialogOpen}
        title={editing ? '编辑补录条目' : '新建补录计划'}
        onCancel={() => setDialogOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="songId" label="曲目" rules={[{ required: true, message: '请选择曲目' }]}>
            <Select options={songs.map((song) => ({ label: songLabel(song.id), value: song.id }))} />
          </Form.Item>
          <Form.Item name="reason" label="补录原因" rules={[{ required: true, message: '请填写补录原因' }]}>
            <Input.TextArea rows={2} placeholder="如：T02 音准偏差，主歌需重录" />
          </Form.Item>
          <Form.Item name="planDate" label="计划日期" rules={[{ required: true, message: '请选择计划日期' }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="state" label="状态" rules={[{ required: true }]}>
            <Select options={RETAKE_STATES.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={importOpen}
        title="导入本地库备份"
        onCancel={() => setImportOpen(false)}
        onOk={doImport}
        okText="确认导入（覆盖现有数据）"
        cancelText="取消"
        width={640}
      >
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
        <Input.TextArea
          rows={10}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder="粘贴导出的 JSON 备份内容"
        />
      </Modal>
    </div>
  );
}
