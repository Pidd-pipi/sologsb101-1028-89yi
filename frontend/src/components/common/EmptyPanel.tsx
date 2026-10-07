/** EmptyPanel：空数据引导与新建入口，被全部列表页消费 */
import type { ReactNode } from 'react';
import { Button, Empty } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

interface EmptyPanelProps {
  title?: string;
  description?: string;
  showCreate?: boolean;
  createText?: string;
  onCreate?: () => void;
  children?: ReactNode;
}

export default function EmptyPanel({
  title = '暂无数据',
  description = '先新建一条记录，或调整筛选条件后再试。',
  showCreate = true,
  createText = '新建',
  onCreate,
  children,
}: EmptyPanelProps) {
  return (
    <div className="empty-panel">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            <div className="empty-panel__title">{title}</div>
            <div className="empty-panel__desc">{description}</div>
          </div>
        }
      >
        {showCreate && onCreate ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            {createText}
          </Button>
        ) : null}
        {children}
      </Empty>
    </div>
  );
}
