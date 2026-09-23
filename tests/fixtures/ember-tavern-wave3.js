export const EMBER_TAVERN_WAVE3=Object.freeze({
  sources:[
    {id:'w3:lore:tavern',sourceType:'LORE',content:'The Ember Tavern is intact and owned by Mara.',at:0},
    {id:'w3:lore:blade',sourceType:'LORE',content:'The Sun Blade is carried by Eris.',at:0},
  ],
  experiences:[
    {id:'w3:e1',sourceType:'EXPERIENCE',content:'Eris leaves the Sun Blade at the Ember Tavern.',at:10},
    {id:'w3:e2',sourceType:'EXPERIENCE',content:'Eris departs the Ember Tavern.',at:20},
    {id:'w3:e3',sourceType:'EXPERIENCE',content:'The Ember Tavern burns down.',at:30},
    {id:'w3:e4',sourceType:'EXPERIENCE',content:'The Sun Blade is destroyed in the fire.',at:30},
    {id:'w3:journal',sourceType:'LORE',content:'A recovered journal claims someone removed the Sun Blade shortly before the fire.',at:50,metadata:{claimAt:30}},
  ],
  query:'Where can Eris find the Sun Blade now?',
  anchors:['sun-blade','eris','ember-tavern'],
});
