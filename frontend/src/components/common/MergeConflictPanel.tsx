/**
 * 合并冲突面板：同一行两边都改动过时，本地版与导入版并列展示，
 * 人挑一版（保留本地 / 采用导入）之后才落地写回业务表。
 */
import { useState } from 'react';
import { Button, Card, List, Space, Table, Tag, Typography } from 'antd';
import type { MergeConflict, ConflictChoice } from '@/types/merge';
import { MERGE_TABLE_LABELS } from '@/utils/merge';

/** 行内元数据字段不参与逐字段对比 */
const META_KEYS = new Set(['id', 'revision', 'createdAt', 'updatedAt']);

interface DiffRow {
  key: string;
  field: string;
  local: string;
  incoming: string;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length > 0 ? value.join('、') : '—';
  return String(value);
}

/** 两版快照逐字段对比，只列出不一致的业务字段 */
function diffRows(conflict: MergeConflict): DiffRow[] {
  const keys = Array.from(
    new Set([...Object.keys(conflict.local), ...Object.keys(conflict.incoming)])
  ).filter((key) => !META_KEYS.has(key));
  return keys
    .map((key) => ({
      key,
      field: key,
      local: formatValue(conflict.local[key]),
      incoming: formatValue(conflict.incoming[key])
    }))
    .filter((row) => row.local !== row.incoming);
}

function revisionOf(row: Record<string, unknown>): string {
  return typeof row.revision === 'number' ? String(row.revision) : '?';
}

interface MergeConflictPanelProps {
  conflicts: MergeConflict[];
  onResolve: (id: string, choice: ConflictChoice) => Promise<void>;
}

export default function MergeConflictPanel({ conflicts, onResolve }: MergeConflictPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function resolve(id: string, choice: ConflictChoice): Promise<void> {
    setBusyId(id);
    try {
      await onResolve(id, choice);
    } finally {
      setBusyId(null);
    }
  }

  if (conflicts.length === 0) return null;

  return (
    <Card
      title={`两版并列的合并冲突（${conflicts.length}）· 挑一版再落地`}
      style={{ marginBottom: 16 }}
    >
      <List
        dataSource={conflicts}
        renderItem={(conflict) => (
          <List.Item key={conflict.id}>
            <Card
              type="inner"
              style={{ width: '100%' }}
              title={
                <Space wrap>
                  <Tag color="orange">{MERGE_TABLE_LABELS[conflict.table]}</Tag>
                  <Typography.Text code>{conflict.rowId}</Typography.Text>
                  <Tag>本地修订号 {revisionOf(conflict.local)}</Tag>
                  <Tag>导入修订号 {revisionOf(conflict.incoming)}</Tag>
                </Space>
              }
              extra={
                <Space>
                  <Button
                    size="small"
                    loading={busyId === conflict.id}
                    onClick={() => void resolve(conflict.id, 'local')}
                  >
                    保留本地版
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    loading={busyId === conflict.id}
                    onClick={() => void resolve(conflict.id, 'incoming')}
                  >
                    采用导入版
                  </Button>
                </Space>
              }
            >
              <Table<DiffRow>
                size="small"
                rowKey="field"
                pagination={false}
                dataSource={diffRows(conflict)}
                columns={[
                  { title: '字段', dataIndex: 'field', width: 160 },
                  { title: '本地版', dataIndex: 'local' },
                  { title: '导入版', dataIndex: 'incoming' }
                ]}
              />
            </Card>
          </List.Item>
        )}
      />
    </Card>
  );
}
