export const EMBER_TAVERN_WORLD = Object.freeze({
  sources: [
    { id: 'lore:ember-tavern', sourceType: 'LORE', content: 'The Ember Tavern is intact and owned by Mara.' },
    { id: 'lore:sun-blade', sourceType: 'LORE', content: 'The Sun Blade is carried by Eris.' },
    { id: 'lore:eris-mara', sourceType: 'LORE', content: 'Eris knows Mara.' },
  ],
  narrative: [
    { id: 'experience:1', sourceType: 'EXPERIENCE', content: 'Eris leaves the Sun Blade at the Ember Tavern.', at: 10 },
    { id: 'experience:2', sourceType: 'EXPERIENCE', content: 'The Ember Tavern burns down.', at: 20 },
    { id: 'experience:3', sourceType: 'EXPERIENCE', content: 'The Sun Blade is destroyed in the fire.', at: 30 },
  ],
  expected: {
    current: [
      ['ember-tavern', 'state', 'destroyed'],
      ['sun-blade', 'state', 'destroyed'],
      ['ember-tavern', 'owner', 'mara'],
    ],
    historical: [
      ['ember-tavern', 'state', 'intact'],
      ['sun-blade', 'location', 'eris'],
      ['sun-blade', 'location', 'ember-tavern'],
      ['sun-blade', 'state', 'intact'],
    ],
    presentQuery: 'Where can Eris find the Sun Blade?',
    historicalQuery: 'What weapon did Eris carry before the tavern fire?',
  },
});
