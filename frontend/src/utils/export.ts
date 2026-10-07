/**
 * 场次记录表 JSON 序列化与校验
 * 补录页用于导出整份棚务记录，也是「导入导出备份」的数据校验入口。
 */
import type { Project } from '../types/project';
import type { Song } from '../types/song';
import type { Session } from '../types/session';
import type { Take } from '../types/take';
import type { Pick } from '../types/pick';
import type { Retake } from '../types/retake';
import { DB_NAME, DB_SCHEMA_VERSION, listPicks, listProjects, listRetakes, listSessions, listSongs, listTakes } from './db';
import { formatDuration, totalDuration } from './timecode';
import { nowIso } from './uuid';

/** 场次记录表中的一行 */
export interface SessionSheetRow {
  sessionId: string;
  date: string;
  period: string;
  roomNo: string;
  engineer: string;
  songTitle: string;
  projectName: string;
  takeCount: number;
  usableCount: number;
  pickedCount: number;
  durationText: string;
}

/** 场次记录表：导出给制作人与委托方存档 */
export interface SessionSheet {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  projects: Project[];
  songs: Song[];
  sessions: Session[];
  takes: Take[];
  picks: Pick[];
  retakes: Retake[];
  summary: {
    projectCount: number;
    songCount: number;
    sessionCount: number;
    takeCount: number;
    usableTakeCount: number;
    usableRatio: number;
    pickedCount: number;
    openRetakeCount: number;
    totalDurationText: string;
    rows: SessionSheetRow[];
  };
}

type WithRevision = { revision?: number; createdAt?: number; updatedAt?: number };

function stripRevision<T extends WithRevision>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.revision;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as T;
}

/** 汇总整份场次记录表 */
export async function buildSessionSheet(): Promise<SessionSheet> {
  const [projects, songs, sessions, takes, picks, retakes] = await Promise.all([
    listProjects(),
    listSongs(),
    listSessions(),
    listTakes(),
    listPicks(),
    listRetakes()
  ]);

  const rows: SessionSheetRow[] = sessions.map((session) => {
    const song = songs.find((item) => item.id === session.songId);
    const project = song ? projects.find((item) => item.id === song.projectId) : undefined;
    const own = takes.filter((item) => item.sessionId === session.id);
    const ownIds = own.map((item) => item.id);
    return {
      sessionId: session.id,
      date: session.date,
      period: session.period,
      roomNo: session.roomNo,
      engineer: session.engineer,
      songTitle: song ? song.title : '曲目已删除',
      projectName: project ? project.name : '项目已删除',
      takeCount: own.length,
      usableCount: own.filter((item) => item.grade === '可用').length,
      pickedCount: picks.filter((item) => ownIds.includes(item.takeId)).length,
      durationText: formatDuration(totalDuration(own))
    };
  });

  const usable = takes.filter((item) => item.grade === '可用').length;

  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    projects: projects.map(stripRevision),
    songs: songs.map(stripRevision),
    sessions: sessions.map(stripRevision),
    takes: takes.map(stripRevision),
    picks: picks.map(stripRevision),
    retakes: retakes.map(stripRevision),
    summary: {
      projectCount: projects.length,
      songCount: songs.length,
      sessionCount: sessions.length,
      takeCount: takes.length,
      usableTakeCount: usable,
      usableRatio: takes.length > 0 ? Math.round((usable / takes.length) * 100) : 0,
      pickedCount: picks.length,
      openRetakeCount: retakes.filter((item) => item.state !== '已完成').length,
      totalDurationText: formatDuration(totalDuration(takes)),
      rows
    }
  };
}

export function serializeSheet(sheet: SessionSheet): string {
  return JSON.stringify(sheet, null, 2);
}

/** 校验并解析场次记录表 / 备份 JSON，失败时抛出可读错误 */
export function parseSheet(text: string): SessionSheet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文本');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('根节点必须是对象');
  }
  const candidate = parsed as Partial<SessionSheet>;
  if (typeof candidate.name !== 'string') throw new Error('缺少 name 字段');
  if (typeof candidate.schemaVersion !== 'number') throw new Error('缺少 schemaVersion 字段');
  if (!Array.isArray(candidate.takes)) throw new Error('takes 必须是数组');
  if (!Array.isArray(candidate.projects)) throw new Error('projects 必须是数组');
  return candidate as SessionSheet;
}

/** 触发浏览器下载（纯前端，无需后端） */
export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
