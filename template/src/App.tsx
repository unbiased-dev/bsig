import { h, signal, computed, For, Show } from 'bsig';

// NOTE: `h` must stay imported — the classic JSX factory needs it in scope
// for `tsc`, and the bsig plugin leaves files that already import it alone.

const count = signal(0);
const doubled = computed(() => count.value * 2);
const items = signal([
  { id: 1, text: 'Write JSX like React' },
  { id: 2, text: 'Get fine-grained updates' },
  { id: 3, text: 'Ship kilobytes, not megabytes' },
]);
const show = signal(true);

export default function App() {
  return (
    <div>
      <h1>bsig + Vite + TS</h1>
      <p>
        Count: {count.value} (x2 = {doubled.value})
      </p>
      <button onClick={() => count.value++}>+</button>
      <button onClick={() => (show.value = !show.value)}>toggle</button>
      <Show when={show.value} fallback={<i>hidden</i>}>
        <ul>{For(items, 'id', (item) => <li>{item.text}</li>)}</ul>
      </Show>
    </div>
  );
}
