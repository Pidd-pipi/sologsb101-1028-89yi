/** StatBadge：Take 总数、可用率、场次时长合计等计数徽标 */
import type { ReactElement } from 'react';
import { Progress } from 'antd';
import {
  BarChartOutlined,
  DashboardOutlined,
  FileTextOutlined,
  PieChartOutlined,
  RiseOutlined,
  WarningOutlined,
} from '@ant-design/icons';

type BadgeTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

interface StatBadgeProps {
  label: string;
  value: number | string;
  suffix?: string;
  /** 占比（0-100） */
  percent?: number;
  tone?: BadgeTone;
  icon?: string;
  showPercent?: boolean;
}

const TONE_COLOR: Record<BadgeTone, string> = {
  default: '#6b6257',
  primary: '#2f6f8f',
  success: '#1e8449',
  warning: '#d68910',
  danger: '#c0392b',
  info: '#4a6fa5',
};

const ICONS: Record<string, ReactElement> = {
  files: <FileTextOutlined />,
  grid: <DashboardOutlined />,
  histogram: <BarChartOutlined />,
  trend: <RiseOutlined />,
  pie: <PieChartOutlined />,
  warning: <WarningOutlined />,
};

export default function StatBadge({
  label,
  value,
  suffix = '',
  percent,
  tone = 'default',
  icon = 'files',
  showPercent = false,
}: StatBadgeProps) {
  const color = TONE_COLOR[tone];
  const display = showPercent && percent !== undefined ? `${percent}%` : value;
  return (
    <div className="stat-badge" style={{ borderLeftColor: color }}>
      <div className="stat-badge__head" style={{ color }}>
        {ICONS[icon] ?? ICONS.files}
        <span>{label}</span>
      </div>
      <div className="stat-badge__body">
        <span className="stat-badge__value">{display}</span>
        {suffix ? <span className="stat-badge__suffix">{suffix}</span> : null}
      </div>
      {percent !== undefined ? (
        <Progress percent={Math.min(100, Math.max(0, percent))} showInfo={false} strokeWidth={6} strokeColor={color} />
      ) : null}
    </div>
  );
}
