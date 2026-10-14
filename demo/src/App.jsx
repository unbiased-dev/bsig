import { signal, computed, For, Show } from 'bsig';

// Card uses React-like props.children — no second arg, no {...children} spread.
function Card(props) {
  return (
    <div class="card">
      {props.title && <h2>{props.title}</h2>}
      <div class="card-body">{props.children}</div>
    </div>
  );
}

export default function App() {
  const name = signal('world');
  const show = signal(true);
  const disabled = signal(false);
  const label = signal('Save');
  const count = signal(0);
  const doubled = computed(() => count.value * 2);
  const items = signal(['a', 'b', 'c']);

  return (
    <div>
      <h1>bsig demo — plain JSX, still fine-grained</h1>

      <Card title="1. Reactive text, no arrow">
        {/* plugin wraps these into () => ... automatically */}
        <p>Hello, {name.value}</p>
        <p>Count: {count.value} (x2 = {doubled.value})</p>
        <button onClick={() => count.value++}>+ count</button>
        <button onClick={() => (name.value = name.value === 'world' ? 'sigwork' : 'world')}>
          toggle name
        </button>
      </Card>

      <Card title="2. Reactive props, no arrow">
        <button disabled={disabled.value} class={disabled.value ? 'opacity-50' : ''}>
          {label.value}
        </button>
        <button onClick={() => (disabled.value = !disabled.value)}>toggle disabled</button>
        <button onClick={() => (label.value = label.value === 'Save' ? 'Saved!' : 'Save')}>
          toggle label
        </button>
      </Card>

      <Card title="3. Conditionals">
        <p>{show.value ? 'visible' : 'hidden'}</p>
        {show.value && <span>Appears, no arrow wrapper in source!</span>}
        <br />
        <button onClick={() => (show.value = !show.value)}>toggle show</button>
        <Show when={show.value} fallback={<i>fallback via {'<Show>'}</i>}>
          <b>Shown via {'<Show>'}</b>
        </Show>
      </Card>

      <Card title="4. Lists">
        <ul>{items.value.map((i) => <li>{i}</li>)}</ul>
        <button onClick={() => (items.value = [...items.value, `n${items.value.length}`])}>
          add item
        </button>
        <ul>{For(items, null, (item) => <li>keyed: {item}</li>)}</ul>
      </Card>

      <Card title="5. Fragments as children (and root-safe runtime)">
        <>
          <p>One</p>
          <p>Two</p>
        </>
      </Card>
    </div>
  );
}
