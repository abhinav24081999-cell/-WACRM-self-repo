import { expect, it } from 'vitest'
import { readAdReferrals, readMessages } from '@/lib/social/meta'

it('captures Instagram message referrals and filters echoes and unrelated recipients', () => {
  const event = {
    sender: { id: 'person' }, recipient: { id: 'account' }, timestamp: 1700000000000,
    message: { mid: 'mid', text: 'Hello', referral: { source: 'ADS', ad_id: '555' } },
  }
  const payload = { object: 'instagram', entry: [{ messaging: [
    event, event, { ...event, recipient: { id: 'other' } },
    { ...event, timestamp: 1700000000001, message: { ...event.message, is_echo: true } },
  ] }] }
  expect([...readAdReferrals(payload, 'instagram', 'account').values()]).toEqual([
    { senderId: 'person', eventKey: 'time:1700000000000:555', attribution: { ad_id: '555', referral_source: 'ADS' } },
  ])
})

it('captures Messenger ad postbacks without inventing an inbox message or counting an organic referral', () => {
  const event = {
    sender: { id: 'person' }, recipient: { id: 'page' }, timestamp: 1700000000000,
    postback: { referral: { source: 'ADS', ad_id: '555', ref: 'offer' } },
  }
  const payload = { object: 'page', entry: [{ id: 'page', messaging: [
    event, { ...event, timestamp: 1700000000001, postback: { referral: { source: 'SHORTLINK' } } },
  ] }, { id: 'other-page', messaging: [event] }] }
  expect(readMessages(payload, 'messenger', 'page')).toEqual([])
  expect([...readAdReferrals(payload, 'messenger', 'page').values()]).toEqual([
    { senderId: 'person', eventKey: 'time:1700000000000:555', attribution: {
      ad_id: '555', referral_source: 'ADS', referral_ref: 'offer',
    } },
  ])
})
