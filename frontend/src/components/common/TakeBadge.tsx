/**
 * TakeBadge：按可用 / 待定 / 废渲染底色与图标，并叠加问题标签角标。
 * 被 Take 标记台、优选汇总页与补录页消费。
 */
import type { ReactElement } from 'react';
import { Badge, Space, Tag, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { TakeGrade, TakeIssue } from '@/types/take';

interface TakeBadgeProps {
  /** 评级 */
  grade: TakeGrade | string;
  /** 问题标签 */
  issues?: TakeIssue[] | string[];
  /** 是否显示问题标签明细 */
  showIssues?: boolean;
}

const GRADE_STYLE: Record<string, { color: string; icon: ReactElement; label: string }> = {
  可用: { color: 'success', icon: <CheckCircleOutlined />, label: '可用' },
  待定: { color: 'warning', icon: <ExclamationCircleOutlined />, label: '待定' },
  废: { color: 'error', icon: <CloseCircleOutlined />, label: '废' },
};

/** 问题标签配色 */
const ISSUE_COLOR: Record<string, string> = {
  音准: 'magenta',
  节奏: 'volcano',
  噪声: 'geekblue',
  破音: 'red',
  无: 'default',
};

export default function TakeBadge({ grade, issues = [], showIssues = true }: TakeBadgeProps) {
  const style = GRADE_STYLE[grade] ?? { color: 'default', icon: <WarningOutlined />, label: String(grade) };
  const realIssues = issues.filter((item) => item !== '无');

  const gradeTag = (
    <Tag color={style.color} icon={style.icon} style={{ borderRadius: 12, paddingInline: 10 }}>
      {style.label}
    </Tag>
  );

  if (!showIssues || realIssues.length === 0) {
    return gradeTag;
  }

  return (
    <Space size={4} wrap>
      <Badge count={realIssues.length} size="small" offset={[2, -2]} color="#c0392b">
        {gradeTag}
      </Badge>
      <Space size={2} wrap>
        {realIssues.map((issue) => (
          <Tooltip key={issue} title={`问题标签：${issue}`}>
            <Tag color={ISSUE_COLOR[issue] ?? 'default'} style={{ marginInlineEnd: 0, fontSize: 11 }}>
              {issue}
            </Tag>
          </Tooltip>
        ))}
      </Space>
    </Space>
  );
}
