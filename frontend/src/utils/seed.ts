/**
 * 首次打开应用时灌入的演示数据
 * 只在 projects 表为空时执行。项目 → 曲目 → 场次 → Take → 优选 / 补录 互相引用，
 * 保证 5 个页面第一次进入都有可点通的内容。函数本身幂等：由调用方判定表是否为空。
 *
 * 注意：这里对 ./db 只做 **类型** 引用（运行期由调用方传入 db 实例），
 * 否则 utils/seed ⇄ utils/db 会互相 import 形成循环依赖。
 * ROW_REVISION 来自叶子模块 ./revision，同样避免运行期依赖 ./db。
 */
import type {
  GbStudioTakeDatabase,
  ProjectRow,
  SongRow,
  SessionRow,
  TakeRow,
  PickRow,
  RetakeRow
} from './db';
import { ROW_REVISION } from './revision';

function rev<T>(row: T): T & { revision: number; createdAt: number; updatedAt: number } {
  const now = Date.now();
  return { ...row, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

const PROJECTS: Array<Omit<ProjectRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'prj-001', name: '城市之光 原声专辑', client: '星海音乐', startDate: '2024-03-04', deliverDate: '2024-05-20', state: '录制中' },
  { id: 'prj-002', name: '民谣合辑《山谷回声》', client: '山谷唱片', startDate: '2024-02-18', deliverDate: '2024-04-30', state: '混音中' },
  { id: 'prj-003', name: '蓝岸汽车 30s 广告配乐', client: '蓝岸汽车', startDate: '2024-01-08', deliverDate: '2024-02-02', state: '已交付' }
];

const SONGS: Array<Omit<SongRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'sg-001', projectId: 'prj-001', title: '序曲·城市之光', durationSec: 245, arrangement: '乐队', state: '录制中' },
  { id: 'sg-002', projectId: 'prj-001', title: '夜航', durationSec: 198, arrangement: '弦乐', state: '待录' },
  { id: 'sg-003', projectId: 'prj-002', title: '山谷回声', durationSec: 231, arrangement: '钢琴独奏', state: '录制中' },
  { id: 'sg-004', projectId: 'prj-003', title: '蓝岸 30s', durationSec: 30, arrangement: '合唱', state: '已完成' }
];

const SESSIONS: Array<Omit<SessionRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'ss-001', songId: 'sg-001', date: '2024-03-12', period: '上午', engineer: '赵鸣', roomNo: 'A 棚', musicians: '鼓：许峰、贝斯：黎川、吉他：程野', state: '已完成' },
  { id: 'ss-002', songId: 'sg-001', date: '2024-03-13', period: '下午', engineer: '赵鸣', roomNo: 'A 棚', musicians: '弦乐四重奏', state: '已完成' },
  { id: 'ss-003', songId: 'sg-002', date: '2024-03-20', period: '晚上', engineer: '何笙', roomNo: 'B 棚', musicians: '大提琴：闻州', state: '已排期' },
  { id: 'ss-004', songId: 'sg-003', date: '2024-03-18', period: '上午', engineer: '赵鸣', roomNo: 'C 棚', musicians: '钢琴：苏禾', state: '已完成' }
];

const TAKES: Array<Omit<TakeRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'tk-001', sessionId: 'ss-001', takeNo: 'T01', startTc: '00:00:12:00', endTc: '00:04:05:00', grade: '可用', issues: ['无'] },
  { id: 'tk-002', sessionId: 'ss-001', takeNo: 'T02', startTc: '00:04:20:00', endTc: '00:08:10:00', grade: '废', issues: ['音准', '节奏'] },
  { id: 'tk-003', sessionId: 'ss-001', takeNo: 'T03', startTc: '00:08:30:00', endTc: '00:12:40:00', grade: '待定', issues: ['噪声'] },
  { id: 'tk-004', sessionId: 'ss-002', takeNo: 'T01', startTc: '00:00:30:00', endTc: '00:03:50:00', grade: '可用', issues: ['无'] },
  { id: 'tk-005', sessionId: 'ss-002', takeNo: 'T02', startTc: '00:04:10:00', endTc: '00:07:25:00', grade: '待定', issues: ['破音'] },
  { id: 'tk-006', sessionId: 'ss-004', takeNo: 'T01', startTc: '00:00:08:00', endTc: '00:03:45:00', grade: '可用', issues: ['无'] }
];

const PICKS: Array<Omit<PickRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'pk-001', takeId: 'tk-001', usage: '主歌', order: 1, note: '第 1 段最稳，鼓组干净' },
  { id: 'pk-002', takeId: 'tk-004', usage: '副歌', order: 2, note: '弦乐起弓整齐' },
  { id: 'pk-003', takeId: 'tk-006', usage: '全曲', order: 3, note: '钢琴整轨留作参考' }
];

const RETAKES: Array<Omit<RetakeRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'rt-001', songId: 'sg-001', reason: 'T02 音准偏差，主歌需重录', planDate: '2024-03-25', state: '已排期' },
  { id: 'rt-002', songId: 'sg-003', reason: '踏板噪声偏大，需重录第二段', planDate: '2024-03-27', state: '待安排' }
];

/** 灌入演示数据（项目 → 曲目 → 场次 → Take → 优选 / 补录）；目标库由调用方传入，避免反向 import */
export async function seedDatabase(target: GbStudioTakeDatabase): Promise<void> {
  await target.transaction(
    'rw',
    [target.projects, target.songs, target.sessions, target.takes, target.picks, target.retakes],
    async () => {
      await target.projects.bulkPut(PROJECTS.map(rev));
      await target.songs.bulkPut(SONGS.map(rev));
      await target.sessions.bulkPut(SESSIONS.map(rev));
      await target.takes.bulkPut(TAKES.map(rev));
      await target.picks.bulkPut(PICKS.map(rev));
      await target.retakes.bulkPut(RETAKES.map(rev));
    }
  );
}
