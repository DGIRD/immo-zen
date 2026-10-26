# Tutoriel vidéo : ajouter un bien en prospection et le simuler

Enregistrement réel de l'application (mode démonstration, services d'adresses et ventes DVF simulés), sous-titré, avec commentaire oral facultatif.

1. `npm run build`
2. Voix (facultatif) : synthétiser chaque phrase de `narration.json` en `<clé>.wav` dans un dossier, avec `durations.json` (`{ "n00": 9.36, … }`). Utilisé pour la version du 26/10/2026 : Piper, voix française « siwis » (CC-BY 4.0).
3. `VOICE_DIR=<dossier des voix> npm run video -- <dossier de sortie>` : images horodatées (`frames/`, `frames.txt`) et instants de chaque phrase (`marks.json`).
4. Assemblage : `ffmpeg -f concat -safe 0 -i frames.txt …` (vidéo à 30 i/s), chaque phrase placée avec `adelay` à son instant, puis `amix` et `loudnorm`.
