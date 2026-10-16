/* bsig — moderate typesafety. Plain values in source, thunks added by compiler. */

export type StopFn = () => void;

export interface Signal<T> {
  get value(): T;
  set value(v: T);
}

export interface ReadonlySignal<T> {
  readonly value: T;
}

export function signal<T>(value: T): Signal<T>;
export function signal<T = undefined>(): Signal<T | undefined>;
export function computed<T>(fn: () => T): ReadonlySignal<T>;
export function reactive<T extends object>(obj: T): T;

export function effect(fn: () => void | StopFn, is_scope?: boolean): StopFn;
export function scope(fn: () => void | StopFn): StopFn;
export function untrack<T>(fn: () => T): T;
export function watch<T>(
  source: Signal<T> | (() => T),
  cb: (newValue: T, oldValue: T) => void
): StopFn;

export function onMount(fn: () => void): void;
export function onUnmount(fn: () => void): void;
export function provide<T = unknown>(key: string | symbol, value: T): void;
export function inject<T = unknown>(key: string | symbol, defaultValue?: T): T | undefined;

export type Child =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | (() => Child | Child[])
  | Child[];

export interface BsProps {
  children?: Child[];
  [key: string]: unknown;
}

export type ComponentFn<P extends BsProps = BsProps> = (props: P) => any;

export function h(tag: string, props: BsProps | null, ...children: Child[]): any;
export function h<P extends BsProps>(
  tag: ComponentFn<P>,
  props: P | null,
  ...children: Child[]
): any;
export function h(tag: null, props: BsProps | null, ...children: Child[]): any;

export function If(
  cond: () => unknown,
  renderFn: () => any,
  fallback?: (() => any) | any
): any;

export interface ShowProps extends BsProps {
  // Source-level: write a plain value (`when={show.value}`) — the Vite
  // plugin wraps JSX props into thunks, so the runtime always receives
  // a getter. Passing a getter by hand also works.
  when: unknown;
  fallback?: any;
}
export function Show(props: ShowProps): any;

export function For<T>(
  list: T[] | Signal<T[]> | (() => T[]),
  key: string | ((item: T, index: number) => unknown) | null,
  renderFn: (item: T, index: number) => any
): any;

// `is` must be a thunk returning the component (`() => Pane`). The JSX plugin
// wraps `is={...}` values automatically; a hand-written `h()` call that passes
// a raw component function invokes it with no props and renders nothing useful.
export function Component(props: BsProps & { is: any }): any;

export type TransitionClasses = [active: string, from: string, to: string];
export interface TransitionProps extends BsProps {
  enter?: TransitionClasses;
  idle?: string;
  leave?: TransitionClasses;
}
export function Transition(props: TransitionProps): any;

declare function mount(
  target: Element,
  root: ComponentFn,
  props?: Record<string, unknown>
): StopFn;

export default mount;

declare global {
  namespace JSX {
    type Element = any;
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown> & { children?: unknown };
    }
  }
}
