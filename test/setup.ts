// Bun test preload: install a happy-dom window as the global browser
// environment, then reset the document between tests so each one starts from a
// clean body while sharing the same window (localStorage, history, event
// listeners on window/document). This is Bun's recommended DOM setup:
// https://bun.com/docs/test/dom
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterEach } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterEach(() => {
  document.body.replaceChildren();
});
