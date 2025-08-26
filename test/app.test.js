const { expect } = require('chai');
const { Gaussian, expandEmbeddedTemplates, generators } = require('../app.js');

describe('app.js core logic', () => {

    describe('Gaussian', () => {
        it('should generate numbers around the mean', () => {
            const mean = 100;
            const stddev = 10;
            const gaussian = new Gaussian(mean, stddev);
            let sum = 0;
            const samples = 10000;
            for (let i = 0; i < samples; i++) {
                sum += gaussian.next();
            }
            const average = sum / samples;
            // The average should be close to the mean.
            expect(average).to.be.closeTo(mean, 2); // Allow a tolerance of 2
        });
    });

    describe('expandEmbeddedTemplates', () => {
        it('should replace placeholders in a string', () => {
            const context = { state: { extracts: { name: 'Jules', city: 'Paris' } } };
            const input = "Hello {name}, welcome to {city}!";
            const expected = "Hello Jules, welcome to Paris!";
            const result = expandEmbeddedTemplates(context, input);
            expect(result).to.equal(expected);
        });

        it('should handle nested objects and arrays', () => {
            const context = { state: { extracts: { user: 'jules', id: '123' } } };
            const input = {
                url: "/users/{user}/posts/{id}",
                data: {
                    author: "{user}",
                    tags: ["a", "{user}"]
                }
            };
            const expected = {
                url: "/users/jules/posts/123",
                data: {
                    author: "jules",
                    tags: ["a", "jules"]
                }
            };
            const result = expandEmbeddedTemplates(context, input);
            expect(result).to.deep.equal(expected);
        });
    });

    describe('generators', () => {
        it('randomString should generate a string of the specified length', () => {
            const length = 16;
            const result = generators.randomString(length);
            expect(result).to.be.a('string');
            expect(result).to.have.lengthOf(length);
        });

        it('randomName should return a name from the list', () => {
            const result = generators.randomName();
            const names = ['Ashish', 'Nikhil', 'Seshadri', 'Kyle', 'Jeff', 'Neha', 'Jin', 'Lewis', 'Fernando', 'Rajeev', 'Mary', 'Sophia', 'Rose', 'Julianna', 'Grace', 'Janice', 'Niko', 'Anish'];
            expect(names).to.include(result);
        });

        it('timestamp should return a number', () => {
            const result = generators.timestamp();
            expect(result).to.be.a('number');
        });
    });
});
