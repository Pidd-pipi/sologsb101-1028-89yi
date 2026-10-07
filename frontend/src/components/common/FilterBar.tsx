/**
 * FilterBar：关键字 + 多选条件过滤，筛选模型由页面双向绑定，
 * 页面负责把模型同步到 URL query（useSearchParams）。
 */
import type { ReactNode } from 'react';
import { Button, Input, Select, Space, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { FilterModel, FilterSelectConfig } from '@/types/filter';

interface FilterBarProps {
  modelValue: FilterModel;
  selects?: FilterSelectConfig[];
  keywordPlaceholder?: string;
  onChange: (next: FilterModel) => void;
  onReset?: () => void;
  /** 右侧附加操作区 */
  extra?: ReactNode;
}

function asArray(value: string | string[] | boolean | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

export default function FilterBar({
  modelValue,
  selects = [],
  keywordPlaceholder = '搜索关键字…',
  onChange,
  onReset,
  extra,
}: FilterBarProps) {
  const activeCount = Object.entries(modelValue)
    .filter(([key]) => key !== 'keyword')
    .reduce((sum, [, value]) => {
      if (Array.isArray(value)) return sum + value.length;
      if (typeof value === 'string' && value.length > 0) return sum + 1;
      if (typeof value === 'boolean' && value) return sum + 1;
      return sum;
    }, 0);

  const patch = (key: string, value: string | string[]): void => {
    onChange({ ...modelValue, [key]: value });
  };

  return (
    <div className="filter-bar">
      <Space size={12} wrap className="filter-bar__main">
        <Input
          allowClear
          style={{ width: 240 }}
          prefix={<SearchOutlined />}
          placeholder={keywordPlaceholder}
          value={String(modelValue.keyword ?? '')}
          onChange={(event) => patch('keyword', event.target.value)}
        />
        {selects.map((select) => (
          <Space key={select.key} size={6}>
            <span className="filter-bar__label">{select.label}</span>
            <Select
              mode={select.multiple === false ? undefined : 'multiple'}
              allowClear
              maxTagCount="responsive"
              style={{ minWidth: 160 }}
              placeholder={select.placeholder ?? `选择${select.label}`}
              value={select.multiple === false ? (asArray(modelValue[select.key])[0] ?? undefined) : asArray(modelValue[select.key])}
              options={select.options}
              onChange={(value) =>
                patch(select.key, select.multiple === false ? ((value as string) ?? '') : ((value as string[]) ?? []))
              }
            />
          </Space>
        ))}
        {extra}
      </Space>
      <Space size={8}>
        {activeCount > 0 ? <Tag color="gold">{activeCount} 项条件</Tag> : null}
        {onReset ? (
          <Button type="link" icon={<ReloadOutlined />} onClick={onReset}>
            重置
          </Button>
        ) : null}
      </Space>
    </div>
  );
}
