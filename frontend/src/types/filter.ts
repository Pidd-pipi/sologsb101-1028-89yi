/** FilterBar 的下拉筛选项 */
export interface FilterSelectOption {
  label: string;
  value: string;
}

/** FilterBar 的下拉筛选配置 */
export interface FilterSelectConfig {
  /** query key，同时作为组件内唯一标识 */
  key: string;
  label: string;
  options: FilterSelectOption[];
  placeholder?: string;
  /** 多选（默认）或单选 */
  multiple?: boolean;
}

/** 筛选模型：keyword + 任意多选/单选字段 */
export interface FilterModel {
  keyword: string;
  [key: string]: string | string[] | boolean;
}
