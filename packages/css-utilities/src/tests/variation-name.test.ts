import {variationName} from '../variation-name';

describe('variationName()', () => {
  it('returns name plus variation value with the first letter capitalized when value is string', () => {
    type Variants = 'white' | 'black';
    const name = 'color';
    const value = 'white';

    expect(variationName<Variants>(name, value)).toBe('colorWhite');
  });

  it('returns name plus variation value when value is number', () => {
    const name = 'size';
    const value = 123;

    expect(variationName(name, value)).toBe('size123');
  });
});
