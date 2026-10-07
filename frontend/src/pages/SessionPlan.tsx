/** /sessions 场次安排与参与乐手：按日期/棚号排期并提示时段冲突 */
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
  Select,
  Space,
  Table,
  Tag,
  message
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import FilterBar from '@/components/common/FilterBar';
import StatBadge from '@/components/common/StatBadge';
import EmptyPanel from '@/components/common/EmptyPanel';
import { useIdbTable } from '@/hooks/useIdbTable';
import { useSessionStore } from '@/stores/sessionStore';
import { useProjectStore } from '@/stores/projectStore';
import { db, type ProjectRow, type SessionRow, type SongRow, type TakeRow } from '@/utils/db';
import {
  SESSION_PERIODS,
  SESSION_STATES,
  STUDIO_ROOMS,
  createEmptySession,
  type Session
} from '@/types/session';
import type { FilterModel, FilterSelectConfig } from '@/types/filter';
import { formatDuration, totalDuration } from '@/utils/timecode';

const asArray = (value: string | string[] | boolean | undefined): string[] => (Array.isArray(value) ? value : []);

export default function SessionPlan() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sessions = useIdbTable<SessionRow>(db.sessions);
  const songs = useIdbTable<SongRow>(db.songs);
  const projects = useIdbTable<ProjectRow>(db.projects);
  const takes = useIdbTable<TakeRow>(db.takes);

  const filters = useSessionStore((state) => state.filters);
  const setFilters = useSessionStore((state) => state.setFilters);
  const resetFilters = useSessionStore((state) => state.resetFilters);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const selectSession = useSessionStore((state) => state.selectSession);
  const createSession = useSessionStore((state) => state.createSession);
  const editSession = useSessionStore((state) => state.editSession);
  const deleteSession = useSessionStore((state) => state.deleteSession);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<Omit<Session, 'id'>>();

  useEffect(() => {
    setFilters({
      keyword: searchParams.get('keyword') ?? '',
      rooms: searchParams.get('rooms') ? (searchParams.get('rooms') as string).split(',') : [],
      periods: searchParams.get('periods') ? (searchParams.get('periods') as string).split(',') : [],
      states: searchParams.get('states') ? (searchParams.get('states') as string).split(',') : []
    });
    // 仅首次挂载还原 URL 筛选
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selects: FilterSelectConfig[] = useMemo(
    () => [
      { key: 'rooms', label: '棚号', options: STUDIO_ROOMS.map((item) => ({ label: item, value: item })) },
      { key: 'periods', label: '时段', options: SESSION_PERIODS.map((item) => ({ label: item, value: item })) },
      { key: 'states', label: '状态', options: SESSION_STATES.map((item) => ({ label: item, value: item })) }
    ],
    []
  );

  function applyFilters(next: FilterModel): void {
    setFilters(next);
    const params: Record<string, string> = {};
    if (String(next.keyword ?? '').length > 0) params.keyword = String(next.keyword);
    asArray(next.rooms).length > 0 && (params.rooms = asArray(next.rooms).join(','));
    asArray(next.periods).length > 0 && (params.periods = asArray(next.periods).join(','));
    asArray(next.states).length > 0 && (params.states = asArray(next.states).join(','));
    setSearchParams(params, { replace: true });
  }

  const songOf = (songId: string): SongRow | null => songs.find((item) => item.id === songId) ?? null;
  const projectNameOf = (songId: string): string => {
    const song = songOf(songId);
    const project = song ? projects.find((item) => item.id === song.projectId) : undefined;
    return project ? project.name : '项目已删除';
  };

  const filtered = useMemo(() => {
    const keyword = String(filters.keyword ?? '').trim().toLowerCase();
    const rooms = asArray(filters.rooms);
    const periods = asArray(filters.periods);
    const states = asArray(filters.states);
    return sessions.filter((session) => {
      const song = songOf(session.songId);
      const label = `${song ? song.title : ''} ${projectNameOf(session.songId)} ${session.engineer} ${session.musicians} ${session.roomNo}`.toLowerCase();
      if (keyword && !label.includes(keyword)) return false;
      if (rooms.length > 0 && !rooms.includes(session.roomNo)) return false;
      if (periods.length > 0 && !periods.includes(session.period)) return false;
      if (states.length > 0 && !states.includes(session.state)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, songs, projects, filters]);

  const scopedSessions = currentProjectId
    ? filtered.filter((session) => songOf(session.songId)?.projectId === currentProjectId)
    : filtered;

  /** 棚号时段占用矩阵提示：同一棚号同一天同一时段出现多次即为冲突 */
  const conflicts = useMemo(() => {
    const seen = new Map<string, number>();
    sessions.forEach((session) => {
      if (session.state === '已取消') return;
      const key = `${session.roomNo}|${session.date}|${session.period}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    });
    return Array.from(seen.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key.replace(/\|/g, ' · '));
  }, [sessions]);

  const totals = useMemo(() => {
    const relevantTakes = takes.filter((take) =>
      scopedSessions.map((session) => session.id).includes(take.sessionId)
    );
    return {
      sessionCount: scopedSessions.length,
      scheduled: scopedSessions.filter((item) => item.state === '已排期').length,
      done: scopedSessions.filter((item) => item.state === '已完成').length,
      musicianSlots: scopedSessions.reduce(
        (sum, item) => sum + item.musicians.split(/[、,，]/).filter((name) => name.trim().length > 0).length,
        0
      ),
      durationText: formatDuration(totalDuration(relevantTakes))
    };
  }, [scopedSessions, takes]);

  async function submit(): Promise<void> {
    const values = await form.validateFields();
    setError(null);
    try {
      if (editing) {
        await editSession(editing.id, values);
        message.success('场次已更新');
      } else {
        await createSession(values);
        message.success('场次已排期');
      }
      setDialogOpen(false);
      setEditing(null);
      form.resetFields();
    } catch (submitError) {
      const text = submitError instanceof Error ? submitError.message : '保存失败';
      setError(text);
      message.error(text);
    }
  }

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h2 className="page__title">场次安排与参与乐手</h2>
          <p className="page__subtitle">同一棚号同一天同一时段只允许一场；冲突会被拦截并提示占用场次。</p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={songs.length === 0}
          onClick={() => {
            setEditing(null);
            setError(null);
            form.setFieldsValue({
              ...createEmptySession(),
              songId: songs.find((song) => song.projectId === currentProjectId)?.id ?? songs[0]?.id ?? ''
            });
            setDialogOpen(true);
          }}
        >
          新增场次
        </Button>
      </div>

      <div className="badge-row">
        <StatBadge label="场次数" value={totals.sessionCount} suffix="场" tone="primary" icon="files" />
        <StatBadge label="已排期" value={totals.scheduled} suffix="场" tone="warning" icon="grid" />
        <StatBadge label="已完成" value={totals.done} suffix="场" tone="success" icon="histogram" />
        <StatBadge label="乐手席位" value={totals.musicianSlots} suffix="人次" tone="info" icon="trend" />
        <StatBadge label="已录时长" value={totals.durationText} tone="danger" icon="pie" />
      </div>

      {conflicts.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`检测到 ${conflicts.length} 处棚号时段占用冲突`}
          description={conflicts.join('；')}
        />
      ) : null}

      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} /> : null}

      <FilterBar
        modelValue={filters}
        selects={selects}
        keywordPlaceholder="搜索曲目 / 项目 / 录音师 / 乐手…"
        onChange={applyFilters}
        onReset={() => {
          resetFilters();
          setSearchParams({}, { replace: true });
        }}
      />

      {scopedSessions.length === 0 ? (
        <EmptyPanel
          title="暂无场次安排"
          description="为曲目安排录制场次，填写棚号、时段、录音师与参与乐手。"
          createText="新增场次"
          showCreate={songs.length > 0}
          onCreate={() => {
            setEditing(null);
            form.setFieldsValue(createEmptySession());
            setDialogOpen(true);
          }}
        />
      ) : (
        <Card title={`场次清单（${scopedSessions.length}）`}>
          <Table<SessionRow>
            rowKey="id"
            dataSource={scopedSessions}
            pagination={false}
            rowClassName={(row) => (row.id === currentSessionId ? 'take-row-selected' : '')}
            onRow={(row) => ({ onClick: () => selectSession(row.id) })}
            columns={[
              {
                title: '曲目 / 项目',
                minWidth: 200,
                render: (_, row) => (
                  <div>
                    <div>{songOf(row.songId)?.title ?? '曲目已删除'}</div>
                    <div className="muted">{projectNameOf(row.songId)}</div>
                  </div>
                )
              },
              { title: '日期', dataIndex: 'date', width: 120 },
              { title: '时段', dataIndex: 'period', width: 90 },
              { title: '棚号', dataIndex: 'roomNo', width: 100 },
              { title: '录音师', dataIndex: 'engineer', width: 100 },
              { title: '参与乐手', dataIndex: 'musicians', minWidth: 200 },
              {
                title: '状态',
                dataIndex: 'state',
                width: 100,
                render: (value: string) => (
                  <Tag color={value === '已完成' ? 'green' : value === '已取消' ? 'default' : 'blue'}>{value}</Tag>
                )
              },
              {
                title: 'Take 条数',
                width: 100,
                render: (_, row) => takes.filter((take) => take.sessionId === row.id).length
              },
              {
                title: '操作',
                width: 170,
                render: (_, row) => (
                  <Space onClick={(event) => event.stopPropagation()}>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        setEditing(row);
                        setError(null);
                        form.setFieldsValue({
                          songId: row.songId,
                          date: row.date,
                          period: row.period,
                          engineer: row.engineer,
                          roomNo: row.roomNo,
                          musicians: row.musicians,
                          state: row.state
                        });
                        setDialogOpen(true);
                      }}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="删除该场次？"
                      description="会级联删除其 Take 与对应优选"
                      onConfirm={async () => {
                        await deleteSession(row.id);
                        message.success('场次已删除');
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
        </Card>
      )}

      <Modal
        open={dialogOpen}
        title={editing ? '编辑场次' : '新增场次'}
        onCancel={() => setDialogOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="songId" label="曲目" rules={[{ required: true, message: '请选择曲目' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={songs.map((song) => ({
                label: `${song.title}（${projects.find((item) => item.id === song.projectId)?.name ?? '未知项目'}）`,
                value: song.id
              }))}
            />
          </Form.Item>
          <Space size={12}>
            <Form.Item name="date" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
              <Input type="date" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="period" label="时段" rules={[{ required: true }]}>
              <Select style={{ width: 140 }} options={SESSION_PERIODS.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
            <Form.Item name="roomNo" label="棚号" rules={[{ required: true }]}>
              <Select style={{ width: 160 }} options={STUDIO_ROOMS.map((item) => ({ label: item, value: item }))} />
            </Form.Item>
          </Space>
          <Form.Item name="engineer" label="录音师" rules={[{ required: true, message: '请填写录音师' }]}>
            <Input placeholder="如：赵鸣" />
          </Form.Item>
          <Form.Item name="musicians" label="参与乐手（顿号分隔）">
            <Input placeholder="如：鼓：许峰、贝斯：黎川" />
          </Form.Item>
          <Form.Item name="state" label="场次状态" rules={[{ required: true }]}>
            <Select options={SESSION_STATES.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
