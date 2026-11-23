import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { checkWebhookUrl } from './endpoints';
import { isPrivateOrReservedIp } from './ssrf';

export class BlockedWebhookDestination extends Error {}

export async function postWebhook(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  readBody = false
) {
  const checked = checkWebhookUrl(url);
  if (!checked.ok) throw new BlockedWebhookDestination();
  const target = new URL(checked.url);
  const hostname = target.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const signal = AbortSignal.timeout(timeoutMs);
  if (/(^|\.)(localhost|local|internal)$/i.test(hostname))
    throw new BlockedWebhookDestination();
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await lookup(hostname, { all: true });
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some(({ address }) => isPrivateOrReservedIp(address))
  ) {
    throw new BlockedWebhookDestination();
  }

  // Pin the TLS request to a validated address while retaining the original certificate hostname.
  const address = addresses.find(({ family }) => family === 4) ?? addresses[0];
  const pinnedLookup: LookupFunction = (_host, options, callback) => {
    if (options.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  };

  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'POST',
        headers,
        signal,
        agent: false,
        lookup: pinnedLookup,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (!readBody || status < 200 || status >= 300) {
          resolve({ status, body: '' });
          res.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 32_768) {
            reject(new Error('Webhook response exceeds 32 KB.'));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({ status, body: Buffer.concat(chunks).toString('utf8') })
        );
        res.on('error', reject);
        res.on('aborted', () =>
          reject(new Error('Webhook response was interrupted.'))
        );
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}
