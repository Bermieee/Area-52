// SYNTHETIC fixture (author-written RP-style lines, not user data). Measures how often the
// deterministic Scene path claims `explicit` (which skips semantic Sidecar extraction in
// applyNativeScene) and what it records.
import { extractDevelopmentDeploymentScene } from '../../../src/deployment/sillytavern-live.js';

const lines = [
  'Mara glances at Eris and sets down her rag.',
  'I look at Kael, waiting for an answer.',
  '"You should not be here," Lyra says, her eyes fixed on the door.',
  'Eris laughs and slides a coin across the counter.',
  'The guard glares at me from across the courtyard.',
  'At Dawn, the bells of Saint Veyra ring out over the harbor.',
  'I sit near Tomas and keep my voice low.',
  'She leans closer. "Tell me what happened to the Sun Blade."',
  'Kael draws his sword as the bandits charge.',
  'We will head to the Silver Keep tomorrow.',
  'Rain drums on the roof while Mira reads the letter again.',
  'He smiles at Anya, then turns back to the map.',
  'I nod slowly and take the offered cup of tea.',
  'The old man mentions Captain Rhys twice before falling silent.',
  'Inside The Gilded Lantern, music spills over the crowd.',
  'Lyra steps in, shaking snow from her cloak.',
  'Tomas leaves without another word.',
  'I stare at The Map for a long moment.',
  'Her hand trembles; the tension in the room is unbearable.',
  'Selene hugs her brother tightly.',
];
let explicit = 0, withCast = 0, withLoc = 0;
for (const l of lines) {
  const r = extractDevelopmentDeploymentScene(l, { revision: 2, evidenceRef: 'ev' });
  if (r.explicit) explicit++;
  const loc = r.fields.location?.value?.location ?? null, cast = r.fields.activeCast?.value?.map((c) => c.characterId + ':' + c.state) ?? [];
  if (loc) withLoc++; if (cast.length) withCast++;
  console.log((r.explicit ? 'EXPLICIT ' : 'semantic ') + JSON.stringify({ loc, cast, atmos: Object.keys(r.fields.atmosphere?.value ?? {}), prefetch: r.prefetchIntents.map((p) => p.locationRefs[0]) }) + '  <- ' + l);
}
console.log(`\n${explicit}/${lines.length} lines take the deterministic path (Sidecar skipped); ${withLoc} set a location, ${withCast} set cast.`);
