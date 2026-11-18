# NDX Warzone — third-party models

All assets below are served locally. No Warzone, Call of Duty, or Combat Master graphics, models, footage, names for operators, or map geometry are redistributed here.

| NDX files | Author, upstream, license |
| --- | --- |
| `operators/warden.glb`, `operators/nomad.glb` | Quaternius, [Toon Shooter Game Kit](https://quaternius.com/packs/toonshootergamekit.html), **CC0 1.0**. Converted GLBs from [Tiny Strike, pinned export and asset notice](https://github.com/guyz/tinystrike/blob/04db555c4fc9f43fef3325c37930ad97a0c27aa3/ASSETS.md), originally `soldier_ct.glb` and `soldier_t.glb`. |
| `armory/raven.glb`, `armory/viper.glb`, `armory/kestrel.glb` | Tiny Strike original art (`m4a1.glb`, `mp5.glb`, `awp.glb`), [pinned upstream and asset notice](https://github.com/guyz/tinystrike/blob/04db555c4fc9f43fef3325c37930ad97a0c27aa3/ASSETS.md), **ISC**. [Full ISC notice](ISC-Tiny-Strike.txt). |
| `armory/mistral.glb`, `armory/bulwark.glb`, `armory/harrier.glb` | **NDX original** viewmodel geometry. Authored here; reproduce with `npm run assets:weapons` from `tools/build-weapon-art.mjs`. No upstream game or image files used. |
| `armory/spectre.glb` | Animated Pistol by Quaternius, [Poly Pizza](https://poly.pizza/m/gmR2e0hWSF), via [Space Pirates, pinned license notice](https://github.com/benjr70/space-pirates/blob/d62a258b5fc5951afdf9715d12a052ca1411c6d3/assets/models/quaternius_pistol/LICENSE.txt). The source pack is CC0; this distribution credits the mirror under **CC BY 3.0**. The GLB is unmodified; the game uses its own mount transforms, material finishes, and muzzle effect. |
| `field/*.glb`, `field/textures/*.jpg` | Quaternius, [Downtown City MegaKit](https://quaternius.com/packs/downtownmegakit.html), **CC0 1.0**, via [Frontline's pinned model credits](https://github.com/Bjeaurn/frontline/blob/8c21bed31e79b0ae31d69d5bf37844b71b3e97f7/crates/frontline/assets/models/CREDITS.md). The `Prop_ACUnit`, `Prop_Bollard`, `Prop_Drain`, `Prop_ManholeCover`, and `Prop_Planter_Single` files are renamed. Their JPEG atlases were resized to a maximum of 512 px per edge. Frontline's separately sourced assets are not included. |

License texts: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/legalcode), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/legalcode), [ISC](ISC-Tiny-Strike.txt).
