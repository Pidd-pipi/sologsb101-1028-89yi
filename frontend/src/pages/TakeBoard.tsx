/** /takes Take 标记台：录入起止时间码、问题标签与评级，支持批量改评级 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tooltip,
  message
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import FilterBar from '@/components/common/FilterBar';
import StatBadge from '@/components/common/StatBadge';
import TakeBadge from '@/components/common/TakeBadge';
import EmptyPanel from '@/components/common/EmptyPanel';
import { useIdbTable } from '@/hooks/useIdbTable';
import { useTakeFilter } from '@/hooks/useTakeFilter';
import { useTakeStore } from '@/stores/takeStore';
import { useSessionStore } from '@/stores/sessionStore';
import { db, type ProjectRow, type SessionRow, type SongRow, type TakeRow } from '@/utils/db';
import { TAKE_GRADES, TAKE_ISSUES, createEmptyTake, type Take, type TakeGrade } from '@/types/take';
import type { FilterSelectConfig } from '@/types/filter';
import {
  formatDuration,
  isOverlapping,
  isTimecode,
  takeDuration,
  tcToSeconds,
  totalDuration,
  suggestNextTakeNo,
  sortByStart
} from '@/utils/timecode';

const asArray = (value: string | string[] | boolean | undefined): string[] => (Array.isArray(value) ? value : []);

export default function TakeBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const takes = useIdbTable<TakeRow>(db.takes);
  const sessions = useIdbTable<SessionRow>(db.sessions);
  const songs = useIdbTable<SongRow>(db.songs);
  const projects = useIdbTable<ProjectRow>(db.projects);

  const { filters, setFilters, resetFilters, filtered } = useTakeFilter(takes, sessions);
  const selectedIds = useTakeStore((state) => state.selectedIds);
  const toggleSelected = useTakeStore((state) => state.toggleSelected);
  const setSelected = useTakeStore((state) => state.setSelected);
  const createTake = useTakeStore((state) => state.createTake);
  const editTake = useTakeStore((state) => state.editTake);
  const deleteTake = useTakeStore((state) => state.deleteTake);
  const batchGrade = useTakeStore((state) => state.batchGrade);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TakeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<Omit<Take, 'id'>>();

  useEffect(() => {
    setFilters({
      keyword: searchParams.get('keyword') ?? '',
      grades: searchParams.get('grades') ? (searchParams.get('grades') as string).split(',') : [],
      issues: searchParams.get('issues') ? (searchParams.get('issues') as string).split(',') : [],
      sessionIds: searchParams.get('sessionIds') ? (searchParams.get('sessionIds') as string).split(',') : [],
      minTc: searchParams.get('minTc') ?? '',
      maxTc: searchParams.get('maxTc') ?? ''
    });
    // 仅首次挂载还原 URL 筛选
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(next: typeof filters): void {
    setFilters(next);
    const params: Record<string, string> = {};
    if (String(next.keyword ?? '').length > 0) params.keyword = String(next.keyword);
    asArray(next.grades).length > 0 && (params.grades = asArray(next.grades).join(','));
    asArray(next.issues).length > 0 && (params.issues = asArray(next.issues).join(','));
    asArray(next.sessionIds).length > 0 && (params.sessionIds = asArray(next.sessionIds).join(','));
    if (String(next.minTc ?? '').length > 0) params.minTc = String(next.minTc);
    if (String(next.maxTc ?? '').length > 0) params.maxTc = String(next.maxTc);
    setSearchParams(params, { replace: true });
  }

  const sessionLabel = (sessionId: string): string => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return '场次已删除';
    const song = songs.find((item) => item.id === session.songId);
    const project = song ? projects.find((item) => item.id === song.projectId) : undefined;
    return `${song ? song.title : '未知曲目'}${project ? ` · ${project.name}` : ''} · ${session.date} ${session.period} · ${session.roomNo}`;
  };

  const selects: FilterSelectConfig[] = useMemo(
    () => [
      { key: 'grades', label: '评级', options: TAKE_GRADES.map((item) => ({ label: item, value: item })) },
      { key: 'issues', label: '问题标签', options: TAKE_ISSUES.map((item) => ({ label: item, value: item })) },
      {
        key: 'sessionIds',
        label: '场次',
        options: sessions.map((item) => ({ label: `${item.date} ${item.period} ${item.roomNo}`, value: item.id }))
      }
    ],
    [sessions]
  );

  const scoped = useMemo(
    () => (currentSessionId ? filtered.filter((take) => take.sessionId === currentSessionId) : filtered),
    [filtered, currentSessionId]
  );

  const totals = useMemo(() => {
    const usable = scoped.filter((take) => take.grade === '可用').length;
    const issues = scoped.filter((take) => take.issues.some((issue) => issue !== '无')).length;
    return {
      total: scoped.length,
      usable,
      pending: scoped.filter((take) => take.grade === '待定').length,
      discarded: scoped.filter((take) => take.grade === '废').length,
      usableRatio: scoped.length > 0 ? Math.round((usable / scoped.length) * 100) : 0,
      issueCount: issues,
      durationText: formatDuration(totalDuration(scoped))
    };
  }, [scoped]);

  const columns: ColumnsType<TakeRow> = [
    {
      title: '场次',
      minWidth: 240,
      render: (_, row) => (
        <div>
          <div>{sessionLabel(row.sessionId)}</div>
          <div className="muted">
            时长 {formatDuration(takeDuration(row.startTc, row.endTc))} · 条次 {row.takeNo}
          </div>
        </div>
      )
    },
    { title: 'Take 号', dataIndex: 'takeNo', width: 90 },
    { title: '起始时间码', dataIndex: 'startTc', width: 130 },
    { title: '结束时间码', dataIndex: 'endTc', width: 130 },
    {
      title: '评级 / 问题标签',
      width: 210,
      render: (_, row) => <TakeBadge grade={row.grade} issues={row.issues} />
    },
    {
      title: '操作',
      width: 150,
      render: (_, row) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditing(row);
              setError(null);
              form.setFieldsValue({
                sessionId: row.sessionId,
                takeNo: row.takeNo,
                startTc: row.startTc,
                endTc: row.endTc,
                grade: row.grade,
                issues: row.issues
              });
              setDialogOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="删除该条次？"
            description="对应的优选记录也会一并删除"
            onConfirm={async () => {
              await deleteTake(row.id);
              message.success('条次已删除');
            }}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  async function submit(): Promise<void> {
    const values = await form.validateFields();
    const start = tcToSeconds(values.startTc);
    const end = tcToSeconds(values.endTc);
    if (Number.isNaN(start) || !isTimecode(values.startTc)) {
      setError('起始时间码格式应为 HH:MM:SS:FF');
      return;
    }
    if (Number.isNaN(end) || !isTimecode(values.endTc)) {
      setError('结束时间码格式应为 HH:MM:SS:FF');
      return;
    }
    if (end <= start) {
      setError('结束时间码必须晚于起始时间码');
      return;
    }
    const siblings = takes.filter((take) => take.sessionId === values.sessionId && take.id !== editing?.id);
    const clash = siblings.find((take) => isOverlapping(values.startTc, values.endTc, take.startTc, take.endTc));
    setError(null);
    if (editing) {
      await editTake(editing.id, values);
      message.success('条次已更新');
    } else {
      await createTake(values);
      message.success('条次已标记');
    }
    if (clash) {
      message.warning(`注意：与同场次 ${clash.takeNo}（${clash.startTc} → ${clash.endTc}）时间码重叠`);
    }
    setDialogOpen(false);
    setEditing(null);
    form.resetFields();
  }

  /** 打开新增弹窗时自动递增 Take 号 */
  function openCreate(): void {
    const targetSessionId = currentSessionId ?? sessions[0]?.id ?? '';
    const siblings = takes.filter((take) => take.sessionId === targetSessionId);
    setEditing(null);
    setError(null);
    form.setFieldsValue({
      ...createEmptyTake(),
      sessionId: targetSessionId,
      takeNo: suggestNextTakeNo(sortByStart(siblings))
    });
    setDialogOpen(true);
  }

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h2 className="page__title">Take 标记台</h2>
          <p className="page__subtitle">
            时间码格式 HH:MM:SS:FF（{25} 帧）；结束时间码必须晚于起始，重叠会给出提示。
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} disabled={sessions.length === 0} onClick={openCreate}>
          标记 Take
        </Button>
      </div>

      <div className="badge-row">
        <StatBadge label="条次总数" value={totals.total} suffix="条" tone="primary" icon="files" />
        <StatBadge label="可用" value={totals.usable} suffix="条" tone="success" icon="grid" />
        <StatBadge label="待定" value={totals.pending} suffix="条" tone="warning" icon="histogram" />
        <StatBadge label="废条" value={totals.discarded} suffix="条" tone="danger" icon="warning" />
        <StatBadge label="可用率" value={totals.usableRatio} percent={totals.usableRatio} showPercent tone="info" icon="pie" />
        <StatBadge label="有问题的条次" value={totals.issueCount} suffix="条" tone="danger" icon="warning" />
        <StatBadge label="合计时长" value={totals.durationText} tone="default" icon="trend" />
      </div>

      <FilterBar
        modelValue={filters}
        selects={selects}
        keywordPlaceholder="搜索 Take 号 / 时间码 / 棚号 / 录音师…"
        onChange={applyFilters}
        onReset={() => {
          resetFilters();
          setSearchParams({}, { replace: true });
        }}
        extra={
          <Space size={6}>
            <span className="filter-bar__label">时间码区间</span>
            <Input
              style={{ width: 140 }}
              placeholder="起始 HH:MM:SS:FF"
              value={String(filters.minTc ?? '')}
              onChange={(event) => applyFilters({ ...filters, minTc: event.target.value })}
            />
            <Input
              style={{ width: 140 }}
              placeholder="结束 HH:MM:SS:FF"
              value={String(filters.maxTc ?? '')}
              onChange={(event) => applyFilters({ ...filters, maxTc: event.target.value })}
            />
          </Space>
        }
      />

      <Card
        title={`条次清单（${scoped.length}）`}
        extra={
          <Space>
            <span className="muted">已选 {selectedIds.length} 条</span>
            <Segmented
              options={TAKE_GRADES}
              disabled={selectedIds.length === 0}
              onChange={(value) => {
                void (async () => {
                  await batchGrade(selectedIds, value as TakeGrade);
                  message.success(`已将 ${selectedIds.length} 条改为「${value}」`);
                })();
              }}
            />
            <Button size="small" disabled={selectedIds.length === 0} onClick={() => setSelected([])}>
              清空选择
            </Button>
          </Space>
        }
      >
        {scoped.length === 0 ? (
          <EmptyPanel
            title="暂无 Take 标记"
            description="为场次标记起止时间码、问题标签与评级。"
            showCreate={sessions.length > 0}
            createText="标记 Take"
            onCreate={openCreate}
          />
        ) : (
          <Table<TakeRow>
            rowKey="id"
            dataSource={scoped}
            columns={columns}
            pagination={false}
            rowSelection={{
              selectedRowKeys: selectedIds,
              onChange: (keys) => setSelected(keys as string[]),
              onSelect: (row) => toggleSelected(row.id)
            }}
          />
        )}
      </Card>

      <Modal
        open={dialogOpen}
        title={editing ? '编辑条次' : '标记 Take'}
        onCancel={() => setDialogOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}
        <Form form={form} layout="vertical">
          <Form.Item name="sessionId" label="场次" rules={[{ required: true, message: '请选择场次' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={sessions.map((session) => ({ label: sessionLabel(session.id), value: session.id }))}
              onChange={(value: string) => {
                const siblings = takes.filter((take) => take.sessionId === value);
                form.setFieldsValue({ takeNo: suggestNextTakeNo(sortByStart(siblings)) });
              }}
            />
          </Form.Item>
          <Space size={12} wrap>
            <Form.Item name="takeNo" label="Take 号" rules={[{ required: true, message: '请填写 Take 号' }]}>
              <Input style={{ width: 120 }} placeholder="如：T04" />
            </Form.Item>
            <Form.Item
              name="startTc"
              label="起始时间码"
              rules={[{ required: true, message: '请填写起始时间码' }]}
              extra={<span className="muted">HH:MM:SS:FF</span>}
            >
              <Input style={{ width: 170 }} placeholder="00:00:00:00" />
            </Form.Item>
            <Form.Item
              name="endTc"
              label="结束时间码"
              rules={[{ required: true, message: '请填写结束时间码' }]}
              extra={<span className="muted">需晚于起始</span>}
            >
              <Input style={{ width: 170 }} placeholder="00:03:20:00" />
            </Form.Item>
          </Space>
          <Form.Item name="grade" label="评级" rules={[{ required: true }]}>
            <Select options={TAKE_GRADES.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
          <Form.Item name="issues" label="问题标签">
            <Select
              mode="multiple"
              options={TAKE_ISSUES.map((item) => ({
                label: item,
                value: item
              }))}
            />
          </Form.Item>
        </Form>
        <Tooltip title="同场次内 Take 号会自动递增，也可手动修改">
          <span className="muted">提示：切换到其它场次会自动带出下一个 Take 号</span>
        </Tooltip>
      </Modal>
    </div>
  );
}
