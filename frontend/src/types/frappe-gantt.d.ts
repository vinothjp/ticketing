// Minimal typings for frappe-gantt v1.x (the package ships no types).
declare module 'frappe-gantt' {
  export interface GanttTask {
    id: string;
    name: string;
    start: string;
    end: string;
    progress?: number;
    dependencies?: string;
    custom_class?: string;
    [key: string]: unknown;
  }

  export interface GanttPopupContext {
    task: GanttTask;
    chart: unknown;
    set_title: (html: string) => void;
    set_subtitle: (html: string) => void;
    set_details: (html: string) => void;
    [key: string]: unknown;
  }

  export interface GanttOptions {
    view_mode?: string;
    view_mode_select?: boolean;
    today_button?: boolean;
    readonly?: boolean;
    readonly_progress?: boolean;
    readonly_dates?: boolean;
    infinite_padding?: boolean;
    popup_on?: 'click' | 'hover';
    scroll_to?: string;
    container_height?: number | 'auto';
    bar_height?: number;
    padding?: number;
    popup?: (ctx: GanttPopupContext) => string | false | undefined | void;
    on_click?: (task: GanttTask) => void;
    on_date_change?: (task: GanttTask, start: Date, end: Date) => void;
    on_progress_change?: (task: GanttTask, progress: number) => void;
    [key: string]: unknown;
  }

  export default class Gantt {
    constructor(wrapper: HTMLElement | string, tasks: GanttTask[], options?: GanttOptions);
    refresh(tasks: GanttTask[]): void;
    change_view_mode(mode?: string): void;
  }
}
