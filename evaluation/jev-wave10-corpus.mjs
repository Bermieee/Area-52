export const JEV_WAVE10_CORPUS_VERSION='10.0.0';
export const JEV_WAVE10_CORPUS_ID='jev-golden-corpus@10.0.0';
const CASES=[
  {
    "caseId": "G01_DETERMINISTIC_SKIP",
    "domain": "GENERIC",
    "title": "Obvious deterministic case skips Jev",
    "ambiguous": false,
    "evidenceAvailable": [
      "E1 current canonical identity"
    ],
    "permittedAuthority": "ADVISORY proposal only",
    "expected": "CHOOSE_ONE O1 without provider invocation",
    "why": "Only one viable option survives deterministic filtering.",
    "request": {
      "decisionId": "wave10:g01",
      "taskId": "task:wave10:g01",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g01",
      "decisionType": "DETERMINISTIC_SELECTION",
      "decisionShape": "CHOOSE_ONE",
      "allowedOutcomes": [
        "CHOOSE_ONE",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O1",
          "label": "Keep sole valid candidate",
          "evidenceRefs": [
            "E1"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Only one candidate satisfies all hard constraints.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "fixture-owner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "deterministicAnswer": {
      "outcome": "DECIDED",
      "decisionCode": "CHOOSE_ONE",
      "selectedOptionIds": [
        "O1"
      ],
      "rejectedOptionIds": [],
      "classification": null,
      "reasonCodes": [
        "DETERMINISTIC_RESULT_SUFFICIENT"
      ],
      "evidenceUsed": [
        "E1"
      ],
      "unresolvedFactors": [],
      "confidence": 1,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Single valid option."
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CHOOSE_ONE",
      "selectedOptionIds": [
        "O1"
      ],
      "rejectedOptionIds": [],
      "classification": null,
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1"
      ],
      "unresolvedFactors": [],
      "confidence": 0.82,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "DECIDED"
      ],
      "selected": [
        [
          "O1"
        ]
      ]
    },
    "operatorExpected": [
      "O1"
    ]
  },
  {
    "caseId": "G02_LORE_TREE_AMBIGUITY",
    "domain": "LORE_FIXTURE",
    "title": "Ambiguous Lore Tree placement",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 identity",
      "E2 role"
    ],
    "permittedAuthority": "ADVISORY; cannot move Tree nodes",
    "expected": "Choose identity or preserve unresolved",
    "why": "Both placements are plausible; identity evidence is broader.",
    "request": {
      "decisionId": "wave10:g02",
      "taskId": "task:wave10:g02",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g02",
      "decisionType": "LORE_TREE_PLACEMENT",
      "decisionShape": "CHOOSE_ONE",
      "allowedOutcomes": [
        "CHOOSE_ONE",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_IDENTITY",
          "label": "Character / Identity",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_ROLE",
          "label": "Character / Role",
          "evidenceRefs": [
            "E2"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Entry defines who Mara is across scenes.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "Entry also describes Mara as tavern keeper.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "LoreOwner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CHOOSE_ONE",
      "selectedOptionIds": [
        "O_IDENTITY"
      ],
      "rejectedOptionIds": [
        "O_ROLE"
      ],
      "classification": "TREE_PLACEMENT",
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [],
      "confidence": 0.82,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "DECIDED",
        "UNRESOLVED",
        "ABSTAINED"
      ],
      "selected": [
        [
          "O_IDENTITY"
        ],
        []
      ]
    },
    "operatorExpected": [
      "O_IDENTITY"
    ]
  },
  {
    "caseId": "G03_UID_DUPLICATE",
    "domain": "LORE_FIXTURE",
    "title": "UID reconciliation — duplicate",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 same event",
      "E2 same payload"
    ],
    "permittedAuthority": "ADVISORY; cannot merge/delete UIDs",
    "expected": "DUPLICATE",
    "why": "Two UIDs restate the same event.",
    "request": {
      "decisionId": "wave10:g03",
      "taskId": "task:wave10:g03",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g03",
      "decisionType": "UID_RECONCILIATION",
      "decisionShape": "CLASSIFY_RELATIONSHIP",
      "allowedOutcomes": [
        "CLASSIFY_RELATIONSHIP",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_DUP",
          "label": "DUPLICATE",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_COMP",
          "label": "COMPLEMENTARY",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_SUCC",
          "label": "TEMPORAL_SUCCESSION",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "UID 41: Mara received Sun Blade on Day 8.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "UID 77: On Day 8 Sun Blade was given to Mara.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "LoreOwner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CLASSIFY_RELATIONSHIP",
      "selectedOptionIds": [
        "O_DUP"
      ],
      "rejectedOptionIds": [
        "O_COMP",
        "O_SUCC"
      ],
      "classification": "DUPLICATE",
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [],
      "confidence": 0.82,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "DECIDED"
      ],
      "selected": [
        [
          "O_DUP"
        ]
      ]
    },
    "operatorExpected": [
      "O_DUP"
    ]
  },
  {
    "caseId": "G04_UID_COMPLEMENTARY",
    "domain": "LORE_FIXTURE",
    "title": "UID reconciliation — complementary",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 event",
      "E2 independent consequence"
    ],
    "permittedAuthority": "ADVISORY; cannot merge/delete UIDs",
    "expected": "COMPLEMENTARY",
    "why": "Second UID adds an independent oath consequence.",
    "request": {
      "decisionId": "wave10:g04",
      "taskId": "task:wave10:g04",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g04",
      "decisionType": "UID_RECONCILIATION",
      "decisionShape": "CLASSIFY_RELATIONSHIP",
      "allowedOutcomes": [
        "CLASSIFY_RELATIONSHIP",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_DUP",
          "label": "DUPLICATE",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_COMP",
          "label": "COMPLEMENTARY",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_SUCC",
          "label": "TEMPORAL_SUCCESSION",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Mara received Sun Blade on Day 8.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "Gift also bound Mara to Ember oath; oath detail is new.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "LoreOwner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CLASSIFY_RELATIONSHIP",
      "selectedOptionIds": [
        "O_COMP"
      ],
      "rejectedOptionIds": [
        "O_DUP",
        "O_SUCC"
      ],
      "classification": "COMPLEMENTARY",
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [],
      "confidence": 0.82,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "DECIDED"
      ],
      "selected": [
        [
          "O_COMP"
        ]
      ]
    },
    "operatorExpected": [
      "O_COMP"
    ]
  },
  {
    "caseId": "G05_UID_TEMPORAL_SUCCESSION",
    "domain": "TEMPORAL_FIXTURE",
    "title": "UID reconciliation — temporal succession",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 Day 8",
      "E2 Day 14"
    ],
    "permittedAuthority": "ADVISORY fixture; Temporal owner remains authoritative",
    "expected": "TEMPORAL_SUCCESSION",
    "why": "Later dated state follows the earlier state.",
    "request": {
      "decisionId": "wave10:g05",
      "taskId": "task:wave10:g05",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g05",
      "decisionType": "UID_RECONCILIATION",
      "decisionShape": "CLASSIFY_RELATIONSHIP",
      "allowedOutcomes": [
        "CLASSIFY_RELATIONSHIP",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_DUP",
          "label": "DUPLICATE",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_COMP",
          "label": "COMPLEMENTARY",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_SUCC",
          "label": "TEMPORAL_SUCCESSION",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Day 8: Mara carries Sun Blade.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "Day 14: Mara deposits Sun Blade in guild vault.",
          "available": true,
          "stale": false,
          "metadata": {
            "temporalStatus": "HISTORICAL"
          }
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "TemporalOwner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CLASSIFY_RELATIONSHIP",
      "selectedOptionIds": [
        "O_SUCC"
      ],
      "rejectedOptionIds": [
        "O_DUP",
        "O_COMP"
      ],
      "classification": "TEMPORAL_SUCCESSION",
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [],
      "confidence": 0.82,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "DECIDED"
      ],
      "selected": [
        [
          "O_SUCC"
        ]
      ]
    },
    "operatorExpected": [
      "O_SUCC"
    ]
  },
  {
    "caseId": "G06_CONTRADICTORY_LORE",
    "domain": "LORE_FIXTURE",
    "title": "Contradictory lore remains unresolved",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 source A",
      "E2 source B"
    ],
    "permittedAuthority": "ADVISORY; cannot declare canon",
    "expected": "UNRESOLVED or ABSTAIN",
    "why": "Equal-authority sources conflict with no precedence.",
    "request": {
      "decisionId": "wave10:g06",
      "taskId": "task:wave10:g06",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g06",
      "decisionType": "LORE_CONTRADICTION",
      "decisionShape": "CHOOSE_ONE",
      "allowedOutcomes": [
        "CHOOSE_ONE",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_ALIVE",
          "label": "Mara survived",
          "evidenceRefs": [
            "E1"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_DEAD",
          "label": "Mara died",
          "evidenceRefs": [
            "E2"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Source A: Mara survived collapse.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "Source B: Mara died in collapse.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "LoreOwner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "UNRESOLVED",
      "decisionCode": "UNRESOLVED",
      "selectedOptionIds": [],
      "rejectedOptionIds": [],
      "classification": null,
      "reasonCodes": [
        "CONTRADICTORY_EVIDENCE"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [
        "Equal-authority sources conflict"
      ],
      "confidence": 0.2,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "UNRESOLVED",
        "ABSTAINED"
      ],
      "selected": [
        []
      ]
    },
    "operatorExpected": []
  },
  {
    "caseId": "G07_SCENE_BOUNDARY",
    "domain": "SCENE_FIXTURE",
    "title": "Scene boundary ambiguity",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 doorway movement",
      "E2 dialogue continuity"
    ],
    "permittedAuthority": "ADVISORY fixture; cannot write Scene state",
    "expected": "Continue same scene or unresolved",
    "why": "Doorway movement occurs without time/cast/dialogue discontinuity.",
    "request": {
      "decisionId": "wave10:g07",
      "taskId": "task:wave10:g07",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g07",
      "decisionType": "SCENE_BOUNDARY",
      "decisionShape": "CHOOSE_ONE",
      "allowedOutcomes": [
        "CHOOSE_ONE",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_SAME",
          "label": "Continue current scene",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_SPLIT",
          "label": "Start new scene",
          "evidenceRefs": [
            "E1"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Mara steps from tavern common room to attached balcony.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "Same conversation continues without time jump.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "SceneOwner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CHOOSE_ONE",
      "selectedOptionIds": [
        "O_SAME"
      ],
      "rejectedOptionIds": [
        "O_SPLIT"
      ],
      "classification": "BOUNDARY_CONTINUITY",
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [],
      "confidence": 0.82,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "DECIDED",
        "UNRESOLVED",
        "ABSTAINED"
      ],
      "selected": [
        [
          "O_SAME"
        ],
        []
      ]
    },
    "operatorExpected": [
      "O_SAME"
    ]
  },
  {
    "caseId": "G08_ENTITY_ALIAS",
    "domain": "GENERIC_FIXTURE",
    "title": "Entity alias ambiguity",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 title use",
      "E2 two matching entities"
    ],
    "permittedAuthority": "ADVISORY; cannot rewrite entity identity",
    "expected": "ABSTAIN or UNRESOLVED",
    "why": "Captain matches two active entities.",
    "request": {
      "decisionId": "wave10:g08",
      "taskId": "task:wave10:g08",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g08",
      "decisionType": "ENTITY_ALIAS",
      "decisionShape": "CHOOSE_ONE",
      "allowedOutcomes": [
        "CHOOSE_ONE",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_MARA",
          "label": "Captain = Mara",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_JON",
          "label": "Captain = Jon",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Narration says only: Captain, over here.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "Both Mara and Jon currently hold captain titles.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "fixture-owner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "ABSTAINED",
      "decisionCode": "ABSTAIN",
      "selectedOptionIds": [],
      "rejectedOptionIds": [],
      "classification": null,
      "reasonCodes": [
        "INSUFFICIENT_DISAMBIGUATION"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [
        "Alias maps to multiple active entities"
      ],
      "confidence": 0.1,
      "abstained": true,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "UNRESOLVED",
        "ABSTAINED"
      ],
      "selected": [
        []
      ]
    },
    "operatorExpected": []
  },
  {
    "caseId": "G09_STATE_TRANSITION_VS_CONTRADICTION",
    "domain": "MEMORY_TEMPORAL_FIXTURE",
    "title": "State transition versus contradiction",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 earlier state",
      "E2 later transition"
    ],
    "permittedAuthority": "ADVISORY fixture; Memory/Temporal owners remain authoritative",
    "expected": "STATE_TRANSITION",
    "why": "Later event explicitly changes the state.",
    "request": {
      "decisionId": "wave10:g09",
      "taskId": "task:wave10:g09",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g09",
      "decisionType": "STATE_RELATIONSHIP",
      "decisionShape": "CLASSIFY_RELATIONSHIP",
      "allowedOutcomes": [
        "CLASSIFY_RELATIONSHIP",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_TRANSITION",
          "label": "STATE_TRANSITION",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_CONTRADICTION",
          "label": "CONTRADICTION",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Day 3: Lysa distrusts Mara.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "Day 9: after rescue, Lysa says she now trusts Mara.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "MemoryTemporalOwner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CLASSIFY_RELATIONSHIP",
      "selectedOptionIds": [
        "O_TRANSITION"
      ],
      "rejectedOptionIds": [
        "O_CONTRADICTION"
      ],
      "classification": "STATE_TRANSITION",
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [],
      "confidence": 0.82,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "DECIDED"
      ],
      "selected": [
        [
          "O_TRANSITION"
        ]
      ]
    },
    "operatorExpected": [
      "O_TRANSITION"
    ]
  },
  {
    "caseId": "G10_SUMMARY_RETENTION_FAILURE",
    "domain": "LORE_FIXTURE",
    "title": "Summary retention failure",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 source fact",
      "E2 summary omission"
    ],
    "permittedAuthority": "ADVISORY; cannot rewrite source",
    "expected": "REWORK summary",
    "why": "Summary drops decision-critical non-transfer ownership.",
    "request": {
      "decisionId": "wave10:g10",
      "taskId": "task:wave10:g10",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g10",
      "decisionType": "SUMMARY_RETENTION",
      "decisionShape": "CHOOSE_ONE",
      "allowedOutcomes": [
        "CHOOSE_ONE",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_KEEP",
          "label": "Accept summary",
          "evidenceRefs": [
            "E2"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_REWORK",
          "label": "Request summary rework",
          "evidenceRefs": [
            "E1",
            "E2"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Sun Blade belongs to Mara and may not be transferred.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "Summary: Mara carries Sun Blade.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "LoreOwner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CHOOSE_ONE",
      "selectedOptionIds": [
        "O_KEEP"
      ],
      "rejectedOptionIds": [
        "O_REWORK"
      ],
      "classification": "RAW_SUMMARY_ACCEPT",
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E2"
      ],
      "unresolvedFactors": [],
      "confidence": 0.72,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "adjudicator": {
      "outcome": "DECIDED",
      "decisionCode": "CHOOSE_ONE",
      "selectedOptionIds": [
        "O_REWORK"
      ],
      "rejectedOptionIds": [
        "O_KEEP"
      ],
      "classification": "RETENTION_FAILURE",
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [],
      "confidence": 0.9,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "DECIDED"
      ],
      "selected": [
        [
          "O_REWORK"
        ]
      ]
    },
    "operatorExpected": [
      "O_REWORK"
    ]
  },
  {
    "caseId": "G11_NO_SAFE_DECISION",
    "domain": "GENERIC",
    "title": "No safe decision / abstention",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 insufficient evidence"
    ],
    "permittedAuthority": "ADVISORY only",
    "expected": "ABSTAIN",
    "why": "Evidence cannot distinguish A from B.",
    "request": {
      "decisionId": "wave10:g11",
      "taskId": "task:wave10:g11",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g11",
      "decisionType": "NO_SAFE_DECISION",
      "decisionShape": "CHOOSE_ONE",
      "allowedOutcomes": [
        "CHOOSE_ONE",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_A",
          "label": "Choose A",
          "evidenceRefs": [
            "E1"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_B",
          "label": "Choose B",
          "evidenceRefs": [
            "E1"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Available evidence cannot distinguish A from B.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "fixture-owner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "ABSTAINED",
      "decisionCode": "ABSTAIN",
      "selectedOptionIds": [],
      "rejectedOptionIds": [],
      "classification": null,
      "reasonCodes": [
        "NO_SAFE_DECISION"
      ],
      "evidenceUsed": [
        "E1"
      ],
      "unresolvedFactors": [
        "No discriminating evidence"
      ],
      "confidence": 0,
      "abstained": true,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "UNRESOLVED",
        "ABSTAINED"
      ],
      "selected": [
        []
      ]
    },
    "operatorExpected": []
  },
  {
    "caseId": "G12_STALE_REVISION",
    "domain": "GENERIC",
    "title": "Stale revision is rejected",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 prior revision"
    ],
    "permittedAuthority": "ADVISORY; stale receipt must not apply",
    "expected": "STALE before provider execution",
    "why": "Current world revision advances beyond request fence.",
    "request": {
      "decisionId": "wave10:g12",
      "taskId": "task:wave10:g12",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g12",
      "decisionType": "STALE_DECISION",
      "decisionShape": "CHOOSE_ONE",
      "allowedOutcomes": [
        "CHOOSE_ONE",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_A",
          "label": "Old-world answer",
          "evidenceRefs": [
            "E1"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_B",
          "label": "Alternative",
          "evidenceRefs": [
            "E1"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Evidence captured at world revision 10.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "fixture-owner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "currentRevisionState": {
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 11,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1"
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CHOOSE_ONE",
      "selectedOptionIds": [
        "O_A"
      ],
      "rejectedOptionIds": [],
      "classification": null,
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1"
      ],
      "unresolvedFactors": [],
      "confidence": 0.82,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "STALE"
      ],
      "selected": [
        []
      ]
    },
    "operatorExpected": []
  },
  {
    "caseId": "G13_PROVIDER_DISAGREEMENT",
    "domain": "GENERIC",
    "title": "Provider disagreement does not become truth",
    "ambiguous": true,
    "evidenceAvailable": [
      "E1 supports A",
      "E2 supports B"
    ],
    "permittedAuthority": "ADVISORY; provider identity has no authority",
    "expected": "UNRESOLVED after disagreement",
    "why": "Qualified providers disagree; disagreement is not a vote.",
    "request": {
      "decisionId": "wave10:g13",
      "taskId": "task:wave10:g13",
      "turnId": "turn:wave10",
      "correlationId": "corr:wave10:g13",
      "decisionType": "PROVIDER_DISAGREEMENT",
      "decisionShape": "CHOOSE_ONE",
      "allowedOutcomes": [
        "CHOOSE_ONE",
        "UNRESOLVED",
        "ABSTAIN"
      ],
      "options": [
        {
          "optionId": "O_A",
          "label": "Interpretation A",
          "evidenceRefs": [
            "E1"
          ],
          "requiresEvidence": true
        },
        {
          "optionId": "O_B",
          "label": "Interpretation B",
          "evidenceRefs": [
            "E2"
          ],
          "requiresEvidence": true
        }
      ],
      "evidenceRefs": [
        {
          "evidenceId": "E1",
          "summary": "Evidence supports interpretation A.",
          "available": true,
          "stale": false,
          "metadata": {}
        },
        {
          "evidenceId": "E2",
          "summary": "Different evidence supports interpretation B.",
          "available": true,
          "stale": false,
          "metadata": {}
        }
      ],
      "constraints": [],
      "authorityBoundary": {
        "authorityClass": "ADVISORY",
        "ownerId": "fixture-owner",
        "destructive": false,
        "operatorOnly": false
      },
      "abstentionAllowed": true,
      "escalationPolicy": {
        "maxRetries": 1,
        "allowedTargets": [
          "OWNER",
          "OPERATOR",
          "UNRESOLVED"
        ]
      },
      "operatorApprovalPolicy": {
        "required": false
      },
      "routing": {
        "expectedDecisionValue": 0.9,
        "latencyPenalty": 0.05,
        "costPenalty": 0.02,
        "uncertaintyPenalty": 0.03,
        "authorityRisk": 0.02,
        "minimumInvocationValue": 0.2
      },
      "sourceRevisionSet": [
        "wave10:source:v1"
      ],
      "worldRevision": 10,
      "sceneRevision": 20,
      "characterStateRevision": 30,
      "domainRevisions": {
        "lore": 4,
        "scene": 7,
        "memory": 3,
        "retrieval": 5
      },
      "freshnessToken": "wave10:fresh:v1",
      "metadata": {
        "corpus": "jev-golden-corpus@10.0.0",
        "fixtureOnly": true,
        "ownerIntegrationClaimed": false
      }
    },
    "providerA": {
      "outcome": "DECIDED",
      "decisionCode": "CHOOSE_ONE",
      "selectedOptionIds": [
        "O_A"
      ],
      "rejectedOptionIds": [
        "O_B"
      ],
      "classification": null,
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E1"
      ],
      "unresolvedFactors": [],
      "confidence": 0.65,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "providerB": {
      "outcome": "DECIDED",
      "decisionCode": "CHOOSE_ONE",
      "selectedOptionIds": [
        "O_B"
      ],
      "rejectedOptionIds": [
        "O_A"
      ],
      "classification": null,
      "reasonCodes": [
        "EVIDENCE_COMPARISON"
      ],
      "evidenceUsed": [
        "E2"
      ],
      "unresolvedFactors": [],
      "confidence": 0.66,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "adjudicator": {
      "outcome": "UNRESOLVED",
      "decisionCode": "UNRESOLVED",
      "selectedOptionIds": [],
      "rejectedOptionIds": [],
      "classification": null,
      "reasonCodes": [
        "PROVIDER_DISAGREEMENT"
      ],
      "evidenceUsed": [
        "E1",
        "E2"
      ],
      "unresolvedFactors": [
        "Qualified providers disagree"
      ],
      "confidence": 0.25,
      "abstained": false,
      "escalationTarget": null,
      "requiresOperator": false,
      "explanation": "Bounded fixture decision."
    },
    "accept": {
      "outcomes": [
        "UNRESOLVED",
        "ABSTAINED"
      ],
      "selected": [
        []
      ]
    },
    "operatorExpected": []
  }
];
export const JEV_WAVE10_CORPUS=Object.freeze(CASES.map(x=>Object.freeze(x)));
export function getWave10Case(caseId){return JEV_WAVE10_CORPUS.find(x=>x.caseId===caseId)??null;}
