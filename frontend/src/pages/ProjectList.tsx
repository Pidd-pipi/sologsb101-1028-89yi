/** /projects 录音项目与曲目台账：新建项目、登记曲目与编制、按状态筛选 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
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
import { PlusOutlined } from '@ant-design/icons';
import FilterBar from '@/components/common/FilterBar';
import StatBadge from '@/components/common/StatBadge';
import EmptyPanel from '@/components/common/EmptyPanel';
import { useIdbTable } from '@/hooks/useIdbTable';
import { useProjectStore } from '@/stores/projectStore';
import { useSessionStore } from '@/stores/sessionStore';
import { db, type PickRow, type ProjectRow, type SessionRow, type SongRow, type TakeRow } from '@/utils/db';
import { PROJECT_STATES, createEmptyProject, type Project } from '@/types/project';
import { SONG_ARRANGEMENTS, SONG_STATES, createEmptySong, type Song } from '@/types/song';
import type { FilterModel, FilterSelectConfig } from '@/types/filter';

const asArray = (value: string | string[] | boolean | undefined): string[] => (Array.isArray(value) ? value : []);

export default function ProjectList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projects = useIdbTable<ProjectRow>(db.projects);
  const songs = useIdbTable<SongRow>(db.songs);
  const sessions = useIdbTable<SessionRow>(db.sessions);
  const takes = useIdbTable<TakeRow>(db.takes);
  const picks = useIdbTable<PickRow>(db.picks);

  const filters = useProjectStore((state) => state.filters);
  const setFilters = useProjectStore((state) => state.setFilters);
  const resetFilters = useProjectStore((state) => state.resetFilters);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const selectProject = useProjectStore((state) => state.selectProject);
  const createProject = useProjectStore((state) => state.createProject);
  const editProject = useProjectStore((state) => state.editProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const createSong = useProjectStore((state) => state.createSong);
  const editSong = useProjectStore((state) => state.editSong);
  const deleteSong = useProjectStore((state) => state.deleteSong);
  const selectSession = useSessionStore((state) => state.selectSession);

  const [projectDialog, setProjectDialog] = useState(false);
  const [songDialog, setSongDialog] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRow | null>(null);
  const [editingSong, setEditingSong] = useState<SongRow | null>(null);
  const [projectForm] = Form.useForm<Omit<Project, 'id'>>();
  const [songForm] = Form.useForm<Omit<Song, 'id'>>();

  useEffect(() => {
    const states = searchParams.get('states');
    setFilters({
      keyword: searchParams.get('keyword') ?? '',
      states: states ? states.split(',') : [],
      clients: searchParams.get('clients') ? (searchParams.get('clients') as string).split(',') : []
    });
    const projectFromQuery = searchParams.get('projectId');
    if (projectFromQuery) selectProject(projectFromQuery);
    // 仅在首次挂载时根据 URL 还原筛选
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selects: FilterSelectConfig[] = useMemo(
    () => [
      { key: 'states', label: '项目状态', options: PROJECT_STATES.map((item) => ({ label: item, value: item })) },
      {
        key: 'clients',
        label: '委托方',
        options: Array.from(new Set(projects.map((item) => item.client))).map((item) => ({ label: item, value: item }))
      }
    ],
    [projects]
  );

  function applyFilters(next: FilterModel): void {
    setFilters(next);
    const params: Record<string, string> = {};
    if (String(next.keyword ?? '').length > 0) params.keyword = String(next.keyword);
    if (asArray(next.states).length > 0) params.states = asArray(next.states).join(',');
    if (asArray(next.clients).length > 0) params.clients = asArray(next.clients).join(',');
    setSearchParams(params, { replace: true });
  }

  const filteredProjects = useMemo(() => {
    const keyword = String(filters.keyword ?? '').trim().toLowerCase();
    const states = asArray(filters.states);
    const clients = asArray(filters.clients);
    return projects.filter((project) => {
      const label = `${project.name} ${project.client}`.toLowerCase();
      if (keyword && !label.includes(keyword)) return false;
      if (states.length > 0 && !states.includes(project.state)) return false;
      if (clients.length > 0 && !clients.includes(project.client)) return false;
      return true;
    });
  }, [projects, filters]);

  const statsOf = (projectId: string) => {
    const ownSongs = songs.filter((song) => song.projectId === projectId);
    const songIds = ownSongs.map((song) => song.id);
    const ownSessions = sessions.filter((session) => songIds.includes(session.songId));
    const sessionIds = ownSessions.map((session) => session.id);
    const ownTakes = takes.filter((take) => sessionIds.includes(take.sessionId));
    const takeIds = ownTakes.map((take) => take.id);
    return {
      songCount: ownSongs.length,
      sessionCount: ownSessions.length,
      pickedTakeCount: picks.filter((pick) => takeIds.includes(pick.takeId)).length,
      availableTakeCount: ownTakes.filter((take) => take.grade === '可用').length
    };
  };

  const totals = useMemo(() => {
    const usable = takes.filter((take) => take.grade === '可用').length;
    return {
      projectCount: projects.length,
      songCount: songs.length,
      sessionCount: sessions.length,
      takeCount: takes.length,
      usableRatio: takes.length > 0 ? Math.round((usable / takes.length) * 100) : 0
    };
  }, [projects, songs, sessions, takes]);

  const currentProject = projects.find((item) => item.id === currentProjectId) ?? null;
  const currentSongs = currentProject ? songs.filter((song) => song.projectId === currentProject.id) : songs;

  async function submitProject(): Promise<void> {
    const values = await projectForm.validateFields();
    if (editingProject) {
      await editProject(editingProject.id, values);
      message.success('项目已更新');
    } else {
      const id = await createProject(values);
      selectProject(id);
      message.success('项目已建档');
    }
    setProjectDialog(false);
    setEditingProject(null);
    projectForm.resetFields();
  }

  async function submitSong(): Promise<void> {
    const values = await songForm.validateFields();
    if (editingSong) {
      await editSong(editingSong.id, values);
      message.success('曲目已更新');
    } else {
      await createSong(values);
      message.success('曲目已登记');
    }
    setSongDialog(false);
    setEditingSong(null);
    songForm.resetFields();
  }

  async function handleDeleteProject(project: ProjectRow): Promise<void> {
    await deleteProject(project.id);
    message.success('项目及其下级记录已删除');
  }

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h2 className="page__title">录音项目与曲目台账</h2>
          <p className="page__subtitle">新建项目后登记曲目与编制；卡片回显曲目数、场次数与已优选 Take 数。</p>
        </div>
        <Space>
          <Button
            onClick={() => {
              setEditingProject(null);
              projectForm.setFieldsValue(createEmptyProject());
              setProjectDialog(true);
            }}
            type="primary"
            icon={<PlusOutlined />}
          >
            新建项目
          </Button>
          <Button
            onClick={() => {
              setEditingSong(null);
              songForm.setFieldsValue({ ...createEmptySong(), projectId: currentProjectId ?? projects[0]?.id ?? '' });
              setSongDialog(true);
            }}
            disabled={projects.length === 0}
          >
            登记曲目
          </Button>
        </Space>
      </div>

      <div className="badge-row">
        <StatBadge label="项目数" value={totals.projectCount} suffix="个" tone="primary" icon="files" />
        <StatBadge label="曲目数" value={totals.songCount} suffix="首" tone="info" icon="grid" />
        <StatBadge label="场次数" value={totals.sessionCount} suffix="场" tone="success" icon="histogram" />
        <StatBadge label="Take 总数" value={totals.takeCount} suffix="条" tone="warning" icon="trend" />
        <StatBadge label="可用率" value={totals.usableRatio} percent={totals.usableRatio} showPercent tone="danger" icon="pie" />
      </div>

      <FilterBar
        modelValue={filters}
        selects={selects}
        keywordPlaceholder="搜索项目名称 / 委托方…"
        onChange={applyFilters}
        onReset={() => {
          resetFilters();
          setSearchParams({}, { replace: true });
        }}
      />

      {filteredProjects.length === 0 ? (
        <EmptyPanel
          title="还没有录音项目"
          description="新建一个录音项目，然后为它登记曲目与录制场次。"
          createText="新建项目"
          onCreate={() => {
            setEditingProject(null);
            projectForm.setFieldsValue(createEmptyProject());
            setProjectDialog(true);
          }}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {filteredProjects.map((project) => {
            const stats = statsOf(project.id);
            const active = project.id === currentProjectId;
            return (
              <Col key={project.id} xs={24} md={12} xl={8}>
                <Card
                  title={<span>{project.name}</span>}
                  extra={<Tag color={active ? 'cyan' : 'default'}>{project.state}</Tag>}
                  style={{ borderColor: active ? '#7fb6d4' : undefined }}
                  actions={[
                    <Button key="select" type="link" onClick={() => selectProject(project.id)}>
                      {active ? '当前项目' : '设为当前'}
                    </Button>,
                    <Button
                      key="edit"
                      type="link"
                      onClick={() => {
                        setEditingProject(project);
                        projectForm.setFieldsValue({
                          name: project.name,
                          client: project.client,
                          startDate: project.startDate,
                          deliverDate: project.deliverDate,
                          state: project.state
                        });
                        setProjectDialog(true);
                      }}
                    >
                      编辑
                    </Button>,
                    <Popconfirm
                      key="delete"
                      title="删除确认"
                      description="会级联删除曲目、场次、Take、优选与补录记录"
                      onConfirm={() => handleDeleteProject(project)}
                    >
                      <Button type="link" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  ]}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Typography.Text type="secondary">委托方：{project.client || '—'}</Typography.Text>
                    <Typography.Text type="secondary">
                      周期：{project.startDate} → {project.deliverDate}
                    </Typography.Text>
                    <Space size={6} wrap>
                      <Tag>曲目 {stats.songCount}</Tag>
                      <Tag>场次 {stats.sessionCount}</Tag>
                      <Tag color="green">可用 Take {stats.availableTakeCount}</Tag>
                      <Tag color="blue">已优选 {stats.pickedTakeCount}</Tag>
                    </Space>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <Card
        title={currentProject ? `${currentProject.name} · 曲目清单` : `全部曲目（${currentSongs.length}）`}
        extra={
          <Space>
            {currentProject ? (
              <Button size="small" onClick={() => selectProject(null)}>
                取消项目筛选
              </Button>
            ) : null}
            <Button
              size="small"
              disabled={sessions.length === 0}
              onClick={() => {
                selectSession(null);
                message.info('可到「场次排期」页为曲目安排录制场次');
              }}
            >
              去排场次
            </Button>
          </Space>
        }
      >
        <Table<SongRow>
          rowKey="id"
          dataSource={currentSongs}
          pagination={false}
          locale={{ emptyText: '暂无曲目' }}
          columns={[
            { title: '曲名', dataIndex: 'title', minWidth: 160 },
            { title: '编制', dataIndex: 'arrangement', width: 110 },
            {
              title: '时长',
              dataIndex: 'durationSec',
              width: 100,
              render: (value: number) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
            },
            {
              title: '状态',
              dataIndex: 'state',
              width: 100,
              render: (value: string) => (
                <Tag color={value === '已完成' ? 'green' : value === '录制中' ? 'orange' : 'default'}>{value}</Tag>
              )
            },
            {
              title: '场次数',
              width: 90,
              render: (_, row) => sessions.filter((session) => session.songId === row.id).length
            },
            {
              title: '可用 Take',
              width: 100,
              render: (_, row) => {
                const sessionIds = sessions.filter((session) => session.songId === row.id).map((session) => session.id);
                return takes.filter((take) => sessionIds.includes(take.sessionId) && take.grade === '可用').length;
              }
            },
            {
              title: '操作',
              width: 170,
              render: (_, row) => (
                <Space>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setEditingSong(row);
                      songForm.setFieldsValue({
                        projectId: row.projectId,
                        title: row.title,
                        durationSec: row.durationSec,
                        arrangement: row.arrangement,
                        state: row.state
                      });
                      setSongDialog(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除该曲目？"
                    description="会级联删除其场次、Take、优选与补录"
                    onConfirm={async () => {
                      await deleteSong(row.id);
                      message.success('曲目已删除');
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

      <Modal
        open={projectDialog}
        title={editingProject ? '编辑项目' : '新建项目'}
        onCancel={() => setProjectDialog(false)}
        onOk={submitProject}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={projectForm} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请填写项目名称' }]}>
            <Input placeholder="如：城市之光 原声专辑" />
          </Form.Item>
          <Form.Item name="client" label="委托方" rules={[{ required: true, message: '请填写委托方' }]}>
            <Input placeholder="如：星海音乐" />
          </Form.Item>
          <Space size={12}>
            <Form.Item name="startDate" label="开始日期" rules={[{ required: true, message: '请选择开始日期' }]}>
              <Input type="date" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="deliverDate" label="交付日期" rules={[{ required: true, message: '请选择交付日期' }]}>
              <Input type="date" style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item name="state" label="项目状态" rules={[{ required: true }]}>
            <Select options={PROJECT_STATES.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={songDialog}
        title={editingSong ? '编辑曲目' : '登记曲目'}
        onCancel={() => setSongDialog(false)}
        onOk={submitSong}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={songForm} layout="vertical">
          <Form.Item name="projectId" label="所属项目" rules={[{ required: true, message: '请选择项目' }]}>
            <Select options={projects.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item name="title" label="曲名" rules={[{ required: true, message: '请填写曲名' }]}>
            <Input placeholder="如：夜航" />
          </Form.Item>
          <Form.Item name="durationSec" label="时长（秒）" rules={[{ required: true, message: '请填写时长' }]}>
            <InputNumber min={5} max={3600} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="arrangement" label="编制" rules={[{ required: true }]}>
            <Select options={SONG_ARRANGEMENTS.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
          <Form.Item name="state" label="录制状态" rules={[{ required: true }]}>
            <Select options={SONG_STATES.map((item) => ({ label: item, value: item }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
