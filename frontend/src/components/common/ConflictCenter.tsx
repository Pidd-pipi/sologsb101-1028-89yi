/**
 * 合并冲突裁决台（公共组件）
 * 离线合并后「两边都改动过」的同一条记录在此两版并列，等人挑一版再落地。
 * 被 Take 标记台（只看 Take 冲突）与补录页导入备份入口（全部表冲突）消费。
 */
import { Button, Card, Empty, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useIdbTable } from '@/hooks/useIdbTable';
import { db, resolveConflict, removeConflict, type ConflictRow } from '@/utils/db';
import type { ConflictChoice, ConflictTable } from '@/types/conflict';

interface FieldDef {
  key: string;
  label: string;
  format?: (value: unknown) => string;
}

const FIELD_DEFS: Record<ConflictTable, FieldDef[]> = {
  takes: [
    { key: 'takeNo', label: 'Take 号' },
    { key: 'startTc', label: '起始时间码' },
    { key: 'endTc', label: '结束时间码' },
    { key: 'grade', label: '评级' },
    { key: 'issues', label: '问题标签', format: (value) => (Array.isArray(value) ? value.join('、') : String(value ?? '')) }
  ],
  picks: [
    { key: 'usage', label: '用途' },
    { key: 'order', label: '顺序' },
    { key: 'note', label: '备注' }
  ],
  projects: [
    { key: 'name', label: '项目名称' },
    { key: 'client', label: '委托方' },
    { key: 'startDate', label: '开始日期' },
    { key: 'deliverDate', label: '交付日期' },
    { key: 'state', label: '状态' }
  ],
  songs: [
    { key: 'title', label: '曲名' },
    { key: 'arrangement', label: '编制' },
    { key: 'durationSec', label: '时长（秒）' },
    { key: 'state', label: '状态' }
  ],
  sessions: [
    { key: 'date', label: '日期' },
    { key: 'period', label: '时段' },
    { key: 'roomNo', label: '棚号' },
    { key: 'engineer', label: '录音师' },
    { key: 'musicians', label: '参与乐手' },
    { key: 'state', label: '状态' }
  ],
  retakes: [
    { key: 'reason', label: '补录原因' },
    { key: 'planDate', label: '计划日期' },
    { key: 'state', label: '状态' }
  ]
};

const TABLE_LABELS: Record<ConflictTable, string> = {
  projects: '项目',
  songs: '曲目',
  sessions: '场次',
  takes: 'Take',
  picks: '优选',
  retakes: '补录'
};

function fieldValue(row: Record<string, unknown>, def: FieldDef): string {
  const raw = row[def.key];
  if (raw === undefined || raw === null) return '—';
  return def.format ? def.format(raw) : String(raw);
}

/** 两版并列：逐字段对照，取值不同的字段高亮 */
function VersionFields({ conflict, side }: { conflict: ConflictRow; side: ConflictChoice }): JSX.Element {
  const row = (side === 'local' ? conflict.localVersion : conflict.incomingVersion) as Record<string, unknown>;
  const other = (side === 'local' ? conflict.incomingVersion : conflict.localVersion) as Record<string, unknown>;
  return (
    <Space direction="vertical" size={2} style={{ minWidth: 200 }}>
      <Tag color={side === 'local' ? 'blue' : 'purple'} style={{ marginBottom: 4 }}>
        {side === 'local' ? `本机版（修订号 ${conflict.localRevision}）` : `导入版（修订号 ${conflict.incomingRevision}）`}
      </Tag>
      {FIELD_DEFS[conflict.table].map((def) => {
        const value = fieldValue(row, def);
        const differs = value !== fieldValue(other, def);
        return (
          <div key={def.key} style={{ fontSize: 12 }}>
            <Typography.Text type="secondary">{def.label}：</Typography.Text>
            <Typography.Text strong={differs} style={differs ? { color: '#cf1322' } : undefined}>
              {value}
            </Typography.Text>
          </div>
        );
      })}
    </Space>
  );
}

interface ConflictCenterProps {
  /** 只展示指定表的冲突；默认全部 */
  tables?: ConflictTable[];
  title?: string;
}

export default function ConflictCenter({ tables, title = '合并冲突待裁决' }: ConflictCenterProps): JSX.Element | null {
  const conflicts = useIdbTable<ConflictRow>(db.conflicts);
  const scoped = tables ? conflicts.filter((item) => tables.includes(item.table)) : conflicts;

  if (scoped.length === 0) return null;

  async function choose(conflict: ConflictRow, choice: ConflictChoice): Promise<void> {
    await resolveConflict(conflict.id, choice);
    message.success(`已采用${choice === 'local' ? '本机' : '导入'}版本并落地，关联统计已重算`);
  }

  const columns: ColumnsType<ConflictRow> = [
    {
      title: '记录',
      width: 130,
      render: (_, row) => {
        const version = row.localVersion as Record<string, unknown>;
        const name = String(version.takeNo ?? version.name ?? version.title ?? version.reason ?? row.rowId);
        return (
          <Space direction="vertical" size={2}>
            <Tag>{TABLE_LABELS[row.table]}</Tag>
            <Typography.Text strong>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.detectedAt.slice(0, 19).replace('T', ' ')}
            </Typography.Text>
          </Space>
        );
      }
    },
    { title: '本机版本', width: 240, render: (_, row) => <VersionFields conflict={row} side="local" /> },
    { title: '导入版本', width: 240, render: (_, row) => <VersionFields conflict={row} side="incoming" /> },
    {
      title: '挑一版落地',
      render: (_, row) => (
        <Space direction="vertical">
          <Space>
            <Button type="primary" size="small" onClick={() => void choose(row, 'local')}>
              采用本机版
            </Button>
            <Button size="small" onClick={() => void choose(row, 'incoming')}>
              采用导入版
            </Button>
          </Space>
          <Button
            type="link"
            size="small"
            danger
            onClick={async () => {
              await removeConflict(row.id);
              message.info('冲突已忽略，保留当前落地的一版');
            }}
          >
            忽略（保留现状）
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Card title={`${title}（${scoped.length}）`} style={{ marginBottom: 16 }}>
      <Table<ConflictRow>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={scoped}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有待裁决的冲突" /> }}
        columns={columns}
      />
    </Card>
  );
}
