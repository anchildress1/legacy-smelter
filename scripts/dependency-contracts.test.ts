// @vitest-environment node
import { findPackageJSON } from 'node:module';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function manifestFor(name: string, parent: string | URL = import.meta.url): URL {
  const manifest = findPackageJSON(name, parent);
  if (!manifest) throw new Error(`Cannot resolve ${name} from ${String(parent)}`);
  return pathToFileURL(manifest);
}

// Resolve from the real consumers so hoisting cannot accidentally test another copy.
const cli = manifestFor('firebase-tools');
const pubsub = manifestFor('@google-cloud/pubsub', cli);
const core = await import(new URL('build/src/index.js', manifestFor('@opentelemetry/core', pubsub)).href);
const api = await import(new URL('build/src/index.js', manifestFor('@opentelemetry/api', pubsub)).href);
const telemetry = await import(new URL('build/src/telemetry-tracing.js', pubsub).href);
const { Gaxios } = await import(new URL('build/src/index.js', manifestFor('gaxios', cli)).href);
const { default: express } = await import(new URL('index.js', manifestFor('express', cli)).href);

describe('Firebase tooling dependency contracts', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('preserves the CLI Express extended query parser', () => {
    const app = express();
    app.set('query parser', 'extended');
    const parse = app.get('query parser fn');
    expect(parse('tag[]=one&tag[]=two&filter[name]=demo')).toEqual({
      tag: ['one', 'two'],
      filter: { name: 'demo' },
    });
    expect(parse('filter[__proto__][polluted]=yes')).toEqual({ filter: {} });
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it('preserves gaxios multipart boundaries and payloads', async () => {
    const adapter = vi.fn(async (options: {
      body: AsyncIterable<string | Uint8Array>;
      headers: Record<string, string>;
    }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
      return {
        config: options,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { contentType: options.headers['Content-Type'], body: Buffer.concat(chunks).toString() },
      };
    });
    const response = await new Gaxios().request({
      url: 'https://upload.example.test',
      method: 'POST',
      multipart: [{ headers: { 'Content-Type': 'text/plain' }, content: 'payload' }],
      adapter,
    });
    const boundary = response.data.contentType.split('boundary=')[1];
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(boundary).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
    expect(response.data.body).toContain(`--${boundary}\r\nContent-Type: text/plain\r\n\r\npayload`);
    expect(response.data.body).toContain(`--${boundary}--`);
  });

  it('preserves PubSub trace context using its real carrier adapters', () => {
    const spanContext = {
      traceId: '12345678901234567890123456789012',
      spanId: '1234567890123456',
      traceFlags: 1,
    };
    const carrier = { attributes: {} };
    const propagator = new core.W3CTraceContextPropagator();
    propagator.inject(api.trace.setSpanContext(api.ROOT_CONTEXT, spanContext), carrier, telemetry.pubsubSetter);
    const extracted = propagator.extract(api.ROOT_CONTEXT, carrier, telemetry.pubsubGetter);
    expect(carrier.attributes).toEqual({ googclient_traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-01` });
    expect(api.trace.getSpanContext(extracted)).toMatchObject(spanContext);
  });

  it.each([
    ['oversized value', `key=${'x'.repeat(9000)}`],
    ['excessive entries', Array.from({ length: 300 }, (_, i) => `key${i}=value`).join(',')],
  ])('bounds extracted baggage with %s', (_label, baggage) => {
    const extracted = new core.W3CBaggagePropagator().extract(
      api.ROOT_CONTEXT,
      { baggage },
      api.defaultTextMapGetter,
    );
    const entries: Array<[string, { value: string }]> = api.propagation.getBaggage(extracted)?.getAllEntries() ?? [];
    expect(entries.length).toBeLessThanOrEqual(180);
    expect(entries.reduce((bytes, [key, entry]) => bytes + Buffer.byteLength(`${key}=${entry.value}`), 0)).toBeLessThanOrEqual(8192);
  });

  it('retains ordinary baggage values', () => {
    const extracted = new core.W3CBaggagePropagator().extract(
      api.ROOT_CONTEXT,
      { baggage: 'tenant=demo,request=123' },
      api.defaultTextMapGetter,
    );
    expect(api.propagation.getBaggage(extracted)?.getAllEntries()).toEqual([
      ['tenant', { value: 'demo' }],
      ['request', { value: '123' }],
    ]);
  });
});
