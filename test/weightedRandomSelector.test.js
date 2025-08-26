const WeightedRandomSelector = require('../lib/weightedRandomSelector.js');
const { expect } = require('chai');

describe('WeightedRandomSelector', () => {
    it('should select items based on their weights', () => {
        const items = [
            ['A', 1],
            ['B', 99]
        ];
        const selector = new WeightedRandomSelector(items);
        const selections = { A: 0, B: 0 };
        for (let i = 0; i < 1000; i++) {
            const selection = selector.select();
            selections[selection[0]]++;
        }
        // With a 1% weight, A should be selected a few times, but far less than B.
        expect(selections.A).to.be.greaterThan(0).and.to.be.lessThan(100);
        expect(selections.B).to.be.greaterThan(900);
    });

    it('should handle items with zero weight', () => {
        const items = [
            ['A', 0],
            ['B', 1]
        ];
        const selector = new WeightedRandomSelector(items);
        for (let i = 0; i < 100; i++) {
            const selection = selector.select();
            expect(selection[0]).to.equal('B');
        }
    });

    it('should handle a single item', () => {
        const items = [
            ['A', 10]
        ];
        const selector = new WeightedRandomSelector(items);
        const selection = selector.select();
        expect(selection[0]).to.equal('A');
    });
});
