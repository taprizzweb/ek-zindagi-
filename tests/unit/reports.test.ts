import { describe, expect, it } from 'vitest';
import {
  csvCell,
  groupBy,
  istDayStart,
  rangeFor,
  statsToCsv,
  totalOf,
  type StatRow,
} from '@/lib/reports/reports';

const row = (over: Partial<StatRow> = {}): StatRow => ({
  day: '2026-10-30',
  officerId: 'o1',
  violation: 'helmet',
  created: 3,
  sent: 2,
  delivered: 1,
  read: 1,
  failed: 1,
  linkOpened: 0,
  ...over,
});

describe('India-time ranges', () => {
  it('"today" starts at 00:00 India time, which is 18:30 UTC the day before', () => {
    expect(istDayStart(new Date('2026-10-30T10:00:00Z')).toISOString()).toBe(
      '2026-10-29T18:30:00.000Z',
    );
    // 19:00 UTC is already the next day in India
    expect(istDayStart(new Date('2026-10-30T19:00:00Z')).toISOString()).toBe(
      '2026-10-30T18:30:00.000Z',
    );
  });
  it('"week" covers seven India-time days including today', () => {
    const { since, until } = rangeFor('week', new Date('2026-10-30T10:00:00Z'));
    expect(since.toISOString()).toBe('2026-10-23T18:30:00.000Z');
    expect(until.getTime()).toBeGreaterThan(new Date('2026-10-30T10:00:00Z').getTime());
  });
});

describe('totals', () => {
  it('sums and groups', () => {
    const rows = [
      row(),
      row({ officerId: 'o2', created: 1, sent: 1, delivered: 0, read: 0, failed: 0 }),
    ];
    expect(totalOf(rows)).toMatchObject({ created: 4, sent: 3, failed: 1 });
    expect(groupBy(rows, (r) => r.officerId).get('o2')).toMatchObject({ created: 1 });
  });
});

describe('CSV', () => {
  it('has a fixed header and only counts and codes', () => {
    const csv = statsToCsv([row()], () => 'JP-0001');
    expect(csv).toBe(
      'date,officer_code,violation,created,sent,delivered,read,failed,link_opened\n2026-10-30,JP-0001,helmet,3,2,1,1,1,0\n',
    );
  });
  it('neutralises spreadsheet formulas and quotes awkward cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(5)).toBe('5');
  });
});
