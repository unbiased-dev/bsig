import { h, signal, For, Show, Component, Transition } from 'bsig';

// Single-arg components, children on props.
function Card(props: { title?: string; children?: unknown }) {
  return (
    <div class="card">
      {props.title && <h2>{props.title}</h2>}
      <div class="card-body">{props.children as never}</div>
    </div>
  );
}

export function TypeSmoke() {
  const name = signal('world');
  const show = signal(true);
  const items = signal([{ id: 1, text: 'a' }]);

  return (
    <div>
      <p>Hello, {name.value as never}</p>
      <button disabled={show.value as never}>{name.value as never}</button>
      <Card title="t">
        <span>hi</span>
      </Card>
      <Show when={() => show.value} fallback={<i>out</i>}>
        <b>in</b>
      </Show>
      <ul>{For(items, 'id', (item) => <li>{item.text as never}</li>)}</ul>
      <Component is={() => Card} title="dyn" />
      <Transition enter={['a', 'b', 'c']}>
        <div>box</div>
      </Transition>
    </div>
  );
}
