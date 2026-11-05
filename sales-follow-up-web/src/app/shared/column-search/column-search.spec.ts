import { ColumnSearch, matchesQuery } from './column-search';

describe('matchesQuery', () => {
  it('matches any field, ignoring case', () => {
    expect(matchesQuery('kav', ['Kavya Menon', null])).toBe(true);
    expect(matchesQuery('globex', ['Hannah', 'Globex Training'])).toBe(true);
    expect(matchesQuery('zed', ['Kavya Menon'])).toBe(false);
    expect(matchesQuery('  ', ['anything'])).toBe(true);
  });

  it('finds phone numbers by their digits', () => {
    expect(matchesQuery('150461', ['+91 9800150461'])).toBe(true);
    expect(matchesQuery('98001 50461', ['+91 9800150461'])).toBe(true);
    expect(matchesQuery('room 150461', ['+91 9800150461'])).toBe(false);
  });
});

describe('ColumnSearch', () => {
  const people = [{ name: 'Kavya' }, { name: 'Yusuf' }];

  it('opens empty, filters one column, and closes back to everything', () => {
    const search = new ColumnSearch();
    search.toggle('NEW');
    expect(search.isOpen('NEW')).toBe(true);
    expect(search.isOpen('WON')).toBe(false);

    search.set('NEW', 'yus');
    expect(search.apply('NEW', people, (p) => [p.name])).toEqual([{ name: 'Yusuf' }]);
    expect(search.apply('WON', people, (p) => [p.name])).toEqual(people);

    search.close('NEW');
    expect(search.isOpen('NEW')).toBe(false);
    expect(search.apply('NEW', people, (p) => [p.name])).toEqual(people);
  });

  it('ignores typing into a box that was just closed', () => {
    const search = new ColumnSearch();
    search.toggle('NEW');
    search.close('NEW');
    search.set('NEW', '');
    expect(search.isOpen('NEW')).toBe(false);
  });
});
