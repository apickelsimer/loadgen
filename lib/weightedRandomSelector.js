// weightedRandomSelector.js
//
// simple weighted random selector.
//
// Copyright © 2013, 2023 Dino Chiesa
// All rights reserved.
//
// created: Fri, 26 Jul 2013  11:14
// last saved: <2023-August-21 19:50:00>
//
// --------------------------------------------------------

class WeightedRandomSelector {
  constructor(a) {
    // A must be an array of arrays. Each inner array is 2 elements,
    // with the item value as the first element and the weight for
    // that value as the second. The items need not be in any
    // particular order.  eg,
    // const fish = [
    //   //["name",      weight]
    //   ["Shark",      3],
    //   ["Shrimp",     50],
    //   ["Sardine",    10],
    //   ["Herring",    20],
    //   ["Anchovies",  10],
    //   ["Mackerel",   50],
    //   ["Tuna",       8]
    // ];

    this.totalWeight = 0;
    this.a = a;
    this.selectionCounts = [];
    this.weightThreshold = [];
    // initialize
    for (let i = 0, L = a.length; i < L; i++) {
      this.totalWeight += a[i][1];
      this.weightThreshold[i] = this.totalWeight;
      this.selectionCounts[i] = 0;
    }
  }

  select() {
    // select a random value
    const R = Math.floor(Math.random() * this.totalWeight);

    // now find the bucket that R value falls into.
    for (let i = 0, L = this.a.length; i < L; i++) {
      if (R < this.weightThreshold[i]) {
        this.selectionCounts[i]++;
        return this.a[i];
      }
    }
    return this.a[this.a.length - 1];
  }
}

module.exports = WeightedRandomSelector;
