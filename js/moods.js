/**
 * 心情标签定义（C 版：纸质手账色板）
 */

const LIST = [
  { key: 'happy',    emoji: '😄', label: '开心', color: '#F6C9E1' },
  { key: 'calm',     emoji: '😌', label: '平静', color: '#CDE6FC' },
  { key: 'excited',  emoji: '🤩', label: '兴奋', color: '#FAECAA' },
  { key: 'love',     emoji: '🥰', label: '幸福', color: '#FFC2D8' },
  { key: 'tired',    emoji: '😪', label: '疲惫', color: '#E0DDD8' },
  { key: 'sad',      emoji: '😔', label: '低落', color: '#D6D2E8' },
  { key: 'angry',    emoji: '😤', label: '烦躁', color: '#FFC9C0' },
  { key: 'anxious',  emoji: '😰', label: '焦虑', color: '#DCCBF0' },
  { key: 'bored',    emoji: '🥱', label: '无聊', color: '#EDE6D6' },
  { key: 'sick',     emoji: '🤒', label: '不适', color: '#CFE8DC' },
  { key: 'busy',     emoji: '🏃', label: '充实', color: '#D1D495' },
  { key: 'thought',  emoji: '🤔', label: '沉思', color: '#BFE3D4' },
];

const MAP = new Map(LIST.map((m) => [m.key, m]));

export const MOODS = {
  list: LIST,
  get(key) { return MAP.get(key) || null; },
  icon(key) { return MAP.get(key)?.emoji || '🙂'; },
  label(key) { return MAP.get(key)?.label || '心情'; },
  color(key) { return MAP.get(key)?.color || '#D8D2C6'; },
};