import * as T from 'three'
import { QUALITY } from '../config.js'
import { assetUrl } from '../site.js'
import { clamp, lerp, randomSource, smooth } from './world.js'
import {
  box,
  canvasTexture,
  cube,
  material,
  mesh,
  surface,
} from './graphics.js'

const palettes = {
  concrete: ['concrete', '#8a9086'],
  plaster: ['plaster', '#a29b83'],
  siding: ['siding', '#657c81'],
  floor: ['concrete', '#747a72'],
  metal: ['metal', '#617075'],
  teal: ['metal', '#406a6f'],
  indigo: ['siding', '#526b80'],
  deck: ['metal', '#697d82'],
  tile: ['concrete', '#a9bab3'],
  signal: [null, '#65a3a7'],
  ember: ['metal', '#a36546'],
  rust: ['metal', '#935e45'],
  roof: ['metal', '#454f50'],
  trim: ['metal', '#5d6764'],
  dark: [null, '#303b3c'],
  wood: ['wood', '#786c50'],
  stone: ['concrete', '#757f71'],
  hazard: [null, '#c38d39'],
  greenmetal: ['metal', '#57715e'],
  glass: [null, '#354b52'],
  warmglass: [null, '#967a54'],
  light: [null, '#d4cbaa'],
  beacon: [null, '#d16d58'],
}
const dummy = new T.Object3D(),
  shade = new T.Color()
const vertexSky = `varying vec3 vDir;
void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`
const fragmentsSky = `varying vec3 vDir;
uniform float uTime;uniform float rain;uniform float detail;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
void main(){
 vec3 d=normalize(vDir);float h=clamp((d.y+.04)/.91,0.,1.);float glow=max(0.,dot(d,normalize(vec3(.60,.21,-.75))));
 vec3 horizon=mix(vec3(.34,.47,.54),vec3(.23,.30,.36),rain);
 vec3 zenith=mix(vec3(.046,.135,.26),vec3(.078,.13,.19),rain);
 vec3 col=mix(horizon,zenith,pow(h,.48));
 col+=vec3(.18,.109,.039)*pow(glow,6.)*(1.-rain*.87);
 vec2 p=d.xz/(max(.076,d.y+.26))*1.72+vec2(uTime*.014,-uTime*.009);
 float cloud=noise(p)*.50+noise(p*2.03+14.)*.28+noise(p*4.12-9.)*.14;
 if(detail>0.5)cloud+=noise(p*8.39+2.)*.08;
 float density=smoothstep(.43-rain*.10,.70-rain*.07,cloud)*smoothstep(-.10,.16,d.y);
 float rim=smoothstep(.44,.56,cloud)*(1.-smoothstep(.56,.70,cloud));
 vec3 cloudCol=mix(vec3(.32,.38,.46),vec3(.21,.25,.30),rain);
 cloudCol+=vec3(.23,.20,.17)*rim*(.40+.60*pow(glow,6.))*(1.-rain*.6);
 col=mix(col,cloudCol,density*.89);col+=vec3(.34,.22,.11)*pow(glow,90.)*(1.-rain)*(.72-density*.42);
 col+=vec3(.71,.56,.36)*smoothstep(.99976,.99991,glow)*(1.-rain*.86);
 gl_FragColor=vec4(col,1.);
 #include <colorspace_fragment>
}`

const twilightSky = `varying vec3 vDir;
uniform float uTime;uniform float rain;
void main(){
 vec3 d=normalize(vDir);float h=smoothstep(-.04,.56,d.y);
 float haze=pow(max(0.,dot(d,normalize(vec3(.71,.08,.72)))),3.5);
 vec3 horizon=mix(vec3(.08,.083,.137),vec3(.24,.128,.128),haze);
 vec3 zenith=vec3(.018,.027,.062);
 vec3 col=mix(horizon,zenith,h);
 float bands=smoothstep(.54,.92,sin((d.x*2.6+d.y*7.1-d.z*.66)*6.+uTime*.027)*.42+.5);
 col+=vec3(.030,.018,.017)*bands*(1.-h)*(.65+rain*.35);
 float moon=max(0.,dot(d,normalize(vec3(-.61,.38,-.68))));
 col+=vec3(.23,.29,.39)*pow(moon,76.)*.4+vec3(.8,.81,.72)*smoothstep(.9995,.99965,moon)*(1.-rain*.72);
 gl_FragColor=vec4(col,1.);
 #include <colorspace_fragment>
}`

const districtLamps = [
  [-32, 2.4, -13, '#61d8ff'],
  [-32, 2.4, 13, '#82ccff'],
  [32, 2.4, -13, '#ff884d'],
  [32, 2.4, 13, '#ff8f6a'],
  [-18.9, 3.9, -24, '#6caaff'],
  [18.9, 3.9, -24, '#ed766f'],
  [-18.9, 3.9, 22, '#68dbfc'],
  [18.9, 3.9, 22, '#ffa168'],
  [-10.6, 2.5, 3.7, '#6eafff'],
  [10.6, 2.5, -3.7, '#ff996a'],
  [0, 4, 14, '#ff8e6c'],
  [0, 3.7, -10, '#7deaff'],
].map(([x, y, z, color]) => ({ x, y, z, color }))

export class Environment {
  constructor(scene, world, quality) {
    this.scene = scene
    this.world = world
    this.quality = quality
    this.neon = world.map.id === 'neon-district'
    this.wet = 0
    this.assetTextures = []
    this.concreteMaterials = []
    this.fogTone = this.neon
      ? '#26334b'
      : world.map.id === 'floodline'
        ? '#97abb3'
        : world.map.id === 'relay-works'
          ? '#8fa0ac'
          : '#8cabb6'
    scene.fog = new T.FogExp2(this.fogTone, 0.0027)
    this.hemi = new T.HemisphereLight('#cee4f0', '#655c45', 2.12)
    scene.add(this.hemi)
    this.sun = new T.DirectionalLight('#ffe4bf', 2.68)
    this.sun.position.set(62, 94, -62)
    scene.add(this.sun, this.sun.target)
    if (this.neon) {
      this.hemi.color.set('#b6d3ff')
      this.hemi.groundColor.set('#9d7796')
      this.sun.color.set('#a1c2ff')
      const warm = new T.DirectionalLight('#ffc1a0', 0.95)
      warm.position.set(6, 9, 6)
      scene.add(warm)
      scene.background = new T.Color('#27304a')
    }
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -62
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 62
    this.sun.shadow.camera.near = 0.1
    this.sun.shadow.camera.far = 230
    this.sun.shadow.normalBias = 0.041
    this.sun.shadow.bias = -0.00013
    this.sun.shadow.mapSize.set(1536, 1536)
    this.sun.shadow.radius = 3.5
    this.skyMat = new T.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        rain: { value: 0 },
        detail: { value: quality === 'low' ? 0 : 1 },
      },
      vertexShader: vertexSky,
      fragmentShader: this.neon ? twilightSky : fragmentsSky,
      side: T.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    this.sky = mesh(new T.SphereGeometry(91, 28, 18), this.skyMat, scene)
    this.sky.renderOrder = -100
    this.sky.frustumCulled = false
    this.fallback = new T.Group()
    scene.add(this.fallback)
    this.buildTerrain()
    this.buildBoxes()
    this.buildVegetation()
    this.buildExtras()
    if (!this.neon) {
      this.buildContactShadows()
      this.buildMarks()
    }
    this.buildWeather()
    this.loadTextures()
    this.applyQuality(quality)
  }
  attachDistrict(model) {
    this.fallback.visible = false
    model.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow =
          !obj.material?.emissiveIntensity ||
          obj.material.emissive?.getHex() === 0
        obj.receiveShadow = true
      }
    })
    this.scene.add(model.scene)
    // Three diffuse lights follow the nearest actual fixtures. Cheap additive
    // pools keep the colored wayfinding legible at every graphics level.
    const glow = canvasTexture(64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      g.addColorStop(0, 'rgba(255,255,255,0.24)')
      g.addColorStop(0.4, 'rgba(255,255,255,0.12)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    })
    const plane = new T.PlaneGeometry(11, 8).rotateX(-Math.PI / 2)
    for (const light of districtLamps) {
      mesh(
        plane,
        new T.MeshBasicMaterial({
          map: glow,
          color: light.color,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
          toneMapped: false,
        }),
        this.scene,
        light.x,
        0.035,
        light.z,
      )
    }
    this.streetLights = Array.from({ length: 3 }, () => {
      const light = new T.PointLight('#ffffff', 36, 13, 2)
      this.scene.add(light)
      return light
    })
    this.updateDistrictLights(0, 0)
  }
  updateDistrictLights(x, z) {
    const close = districtLamps
      .map((s) => [s, (x - s.x) ** 2 + (z - s.z) ** 2])
      .sort((a, b) => a[1] - b[1])
    for (const [i, light] of this.streetLights.entries()) {
      const [s] = close[i]
      light.color.set(s.color)
      light.position.set(s.x, s.y, s.z)
    }
  }
  applyQuality(quality) {
    this.quality = quality
    const q = QUALITY[quality]
    this.sun.castShadow = q.shadows
    this.skyMat.uniforms.detail.value = quality === 'low' ? 0 : 1
    if (this.weatherGeo) this.weatherGeo.setDrawRange(0, q.particles * 2)
    for (const batch of this.vegetationBatches ?? [])
      batch.count = Math.floor(batch.userData.max * q.vegetation)
    if (this.groundPhoto?.image) {
      this.terrain.bumpMap = q.shadows ? this.groundPhoto : null
      this.terrain.bumpScale = 0.08
      this.terrain.needsUpdate = true
    }
  }
  buildTerrain() {
    const w = this.world,
      n = QUALITY[this.quality].terrain,
      geo = new T.PlaneGeometry(w.extent, w.extent, n, n)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position,
      uv = geo.attributes.uv,
      colors = []
    const a = new T.Color('#a2a28b'),
      b = new T.Color('#72856a'),
      c = new T.Color('#b3a07e'),
      rock = new T.Color('#a7aca9')
    const sand = new T.Color('#b1ab92'),
      gray = new T.Color('#979b93')
    const color = new T.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i),
        y = w.height(x, z)
      pos.setY(i, y)
      uv.setXY(i, x * 0.182, z * 0.182)
      const hash =
        (Math.sin(x * 0.121 + Math.cos(z * 0.17) * 1.8) * Math.cos(z * 0.097) +
          Math.sin(x * 0.049 + z * 0.061) * 0.7) *
          0.28 +
        0.51
      const slope = Math.abs(w.height(x + 1.21, z - 0.84) - y)
      if (w.map.id === 'floodline')
        color
          .set('#839493')
          .lerp(b, clamp(hash * 0.62, 0, 1))
          .lerp(sand, smooth(11, 36, y) * 0.45)
      else if (this.neon) color.set('#454b5b')
      else if (w.map.id === 'relay-works')
        color
          .set('#919c9c')
          .lerp(rock, clamp(hash * 0.75, 0, 1))
          .lerp(b, smooth(2, 17, y) * 0.43)
      else if (w.kind === 'ridge')
        color
          .copy(a)
          .lerp(b, clamp(hash, 0, 1))
          .lerp(c, smooth(0.7, 1.05, hash) * 0.69)
          .lerp(rock, smooth(28, 91, y) * 0.73 + smooth(0.5, 1.6, slope) * 0.21)
      else if (w.kind === 'yard')
        color
          .copy(gray)
          .lerp(sand, clamp(hash * 0.64, 0, 1))
          .lerp(rock, smooth(8, 34, y) * 0.72)
      else
        color
          .copy(sand)
          .lerp(b, clamp(hash * 0.45, 0, 1))
          .lerp(
            rock,
            smooth(5, 39, y) * 0.63 + smooth(0.32, 1.16, slope) * 0.24,
          )
      color.multiplyScalar(0.91 + Math.sin(x * 0.18 - z * 0.13) * 0.06)
      colors.push(color.r, color.g, color.b)
    }
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    const tex = surface('ground', '#b0ad9c', this.world.seed)
    const roads = this.roadMask()
    this.terrain = new T.MeshStandardMaterial({
      vertexColors: true,
      map: tex,
      roughness: 0.98,
    })
    this.terrain.onBeforeCompile = (shader) => {
      shader.uniforms.ndxRoad = { value: roads }
      shader.vertexShader =
        `varying vec2 vField;\n${shader.vertexShader}`.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvField=position.xz;',
        )
      shader.fragmentShader =
        `uniform sampler2D ndxRoad;varying vec2 vField;\n${shader.fragmentShader}`.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        vec2 maskUv=vec2(vField.x,-vField.y)/${w.extent.toFixed(1)}+.5;
        vec4 pavement=texture2D(ndxRoad,maskUv);
        float detailVal=clamp((sampledDiffuseColor.r+sampledDiffuseColor.g+sampledDiffuseColor.b)*.54,.48,1.23);
        diffuseColor.rgb=mix(diffuseColor.rgb,pavement.rgb*detailVal,pavement.a*.97);`,
        )
    }
    const m = mesh(geo, this.terrain, this.fallback)
    m.receiveShadow = true
  }
  roadMask() {
    const w = this.world,
      n = w.kind === 'ridge' && this.quality !== 'low' ? 2048 : 1024
    const tex = canvasTexture(n, n, (ctx) => {
      const a = n / w.extent,
        p = (x) => n * 0.5 + a * x
      const render = (road, width, color, dashes = false) => {
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = Math.max(0.9, width * a)
        ctx.strokeStyle = color
        ctx.setLineDash(
          dashes ? [Math.max(2.6, a * 3.5), Math.max(2.7, a * 4.8)] : [],
        )
        ctx.beginPath()
        road.points.forEach(([x, z], i) => {
          if (i) ctx.lineTo(p(x), p(z))
          else ctx.moveTo(p(x), p(z))
        })
        ctx.stroke()
      }
      for (const road of w.roads) render(road, road.width * 1.24, '#9d9072c0')
      for (const road of w.roads)
        render(
          road,
          road.width * 0.99,
          w.kind === 'range' ? '#8e8170' : '#586362',
        )
      for (const road of w.roads)
        if (road.paint) render(road, 0.25, '#c3ad7fc3', true)
    })
    this.assetTextures.push(tex)
    return tex
  }
  loadTextures() {
    const loader = new T.TextureLoader()
    const load = (file, apply) => {
      const tex = loader.load(
        assetUrl(`media/surfaces/${file}.webp`),
        (t) => {
          if (!this.disposed) apply(t)
          else t.dispose()
        },
        undefined,
        () => {},
      )
      tex.colorSpace = T.SRGBColorSpace
      tex.wrapS = tex.wrapT = T.RepeatWrapping
      tex.anisotropy = 4
      this.assetTextures.push(tex)
      return tex
    }
    this.groundPhoto = load('gravel', (tex) => {
      this.terrain.map?.dispose()
      this.terrain.map = tex
      if (this.quality === 'high') {
        this.terrain.bumpMap = tex
        this.terrain.bumpScale = 0.08
      }
      this.terrain.needsUpdate = true
    })
    load('concrete', (tex) => {
      for (const mat of this.concreteMaterials) {
        mat.map?.dispose()
        mat.map = tex
        mat.needsUpdate = true
      }
    })
  }
  buildBoxes() {
    const classes = new Map(),
      ge = cube()
    for (const b of this.world.boxes) {
      if (!classes.has(b.mat)) classes.set(b.mat, [])
      classes.get(b.mat).push(b)
    }
    for (const [name, items] of classes) {
      const [pattern, color] = palettes[name] ?? palettes.concrete
      const mat = material(
        color,
        name.includes('glass') ? 0.29 : 0.79,
        pattern === 'metal' ? 0.28 : 0.06,
        pattern ? surface(pattern, '#d1d1cb', name.length * 137) : null,
      )
      if (['concrete', 'plaster'].includes(pattern))
        this.concreteMaterials.push(mat)
      if (['light', 'beacon', 'warmglass'].includes(name)) {
        mat.emissive = new T.Color(color)
        mat.emissiveIntensity = name === 'light' ? 0.67 : 0.29
      }
      const batch = new T.InstancedMesh(ge, mat, items.length)
      this.fallback.add(batch)
      for (let i = 0; i < items.length; i++) {
        const b = items[i]
        dummy.position.set(b.x, b.y + b.h * 0.5, b.z)
        dummy.rotation.set(0, b.ry, 0)
        dummy.scale.set(b.w, b.h, b.d)
        dummy.updateMatrix()
        batch.setMatrixAt(i, dummy.matrix)
        shade.setScalar(b.tint)
        batch.setColorAt(i, shade)
      }
      batch.castShadow = ![
        'dark',
        'trim',
        'glass',
        'warmglass',
        'light',
        'beacon',
        'hazard',
      ].includes(name)
      batch.receiveShadow = true
      batch.computeBoundingSphere()
    }
  }
  buildVegetation() {
    const all = this.world.vegetation,
      pine = all.filter((v) => v.type === 'pine'),
      scrub = all.filter((v) => v.type === 'scrub')
    this.vegetationBatches = []
    const place = (kind, geo, mat, positions) => {
      const batch = new T.InstancedMesh(
        geo,
        mat,
        kind.length * positions.length,
      )
      this.scene.add(batch)
      let i = 0
      for (const t of kind)
        for (const [x, y, z, w, h, d, g] of positions) {
          dummy.position.set(t.x + x * t.s, t.y + y * t.s, t.z + z * t.s)
          dummy.scale.set(w * t.s, h * t.s, d * t.s)
          dummy.rotation.set(0, t.ry, 0)
          dummy.updateMatrix()
          batch.setMatrixAt(i, dummy.matrix)
          shade.setScalar(t.tint * g)
          batch.setColorAt(i++, shade)
        }
      batch.receiveShadow = true
      batch.castShadow = kind === pine
      batch.userData.max = i
      batch.computeBoundingSphere()
      this.vegetationBatches.push(batch)
    }
    place(pine, new T.CylinderGeometry(0.14, 0.24, 1, 6), material('#494b3f'), [
      [0, 2.6, 0, 0.98, 5.8, 1, 1],
    ])
    const vertices = [],
      tints = []
    const n = 11
    for (let layer = 0; layer < 8; layer++) {
      const r = 2.17 * (1 - layer / 8.45) ** 0.9,
        y = 1.11 + layer * 0.68,
        tip = y + 1.69 - layer * 0.059
      const twist = layer * 2.17,
        trunkTop = [
          Math.sin(layer * 1.49) * 0.18,
          tip,
          Math.cos(layer * 2.08) * 0.14,
        ]
      const outer = (i) => {
        const a = (i / n) * Math.PI * 2 + twist
        const s =
          r *
          (0.59 +
            Math.abs(Math.sin(i * 9.183 + layer * 2.87)) * 0.43 +
            ((i + layer) % 3 === 0 ? 0.24 : 0))
        return [
          Math.cos(a) * s,
          y + Math.sin(i * 4.6 + layer * 2.09) * 0.28,
          Math.sin(a) * s * 0.94,
        ]
      }
      for (let i = 0; i < n; i++) {
        const a = outer(i),
          b = outer((i + 1) % n),
          middle = a.map((v, j) => (v + b[j]) * 0.42 + trunkTop[j] * 0.16)
        middle[1] += 0.28 + Math.sin(i * 5 + layer * 3) * 0.11
        const bottom = [trunkTop[0], y - 0.12, trunkTop[2]]
        vertices.push(
          ...a,
          ...middle,
          ...trunkTop,
          ...middle,
          ...b,
          ...trunkTop,
          ...a,
          ...bottom,
          ...middle,
          ...middle,
          ...bottom,
          ...b,
        )
        for (const v of [
          0.63, 0.82, 0.99, 0.82, 0.76, 1.01, 0.64, 0.49, 0.71, 0.71, 0.5, 0.68,
        ])
          tints.push(v, v * (0.97 + layer * 0.009), v * 0.98)
      }
    }
    const needles = new T.BufferGeometry()
    needles.setAttribute('position', new T.Float32BufferAttribute(vertices, 3))
    needles.setAttribute('color', new T.Float32BufferAttribute(tints, 3))
    needles.computeVertexNormals()
    const pineMat = new T.MeshStandardMaterial({
      color: '#577157',
      vertexColors: true,
      roughness: 0.97,
      side: T.DoubleSide,
    })
    place(pine, needles, pineMat, [[0, 0, 0, 1, 1, 1, 1]])
    place(scrub, new T.IcosahedronGeometry(1, 1), material('#5d6e4b', 1), [
      [0, 0.37, 0, 0.92, 0.52, 0.66, 0.8],
      [-0.44, 0.3, 0.18, 0.6, 0.47, 0.67, 1.03],
      [0.36, 0.38, -0.22, 0.8, 0.67, 0.68, 0.91],
    ])
  }
  buildExtras() {
    const rocks = this.world.extras.filter((x) => x.type === 'rock')
    const rockMat = material(
      '#82887d',
      0.95,
      0,
      surface('concrete', '#b7b5a8', 31),
    )
    const rockGe = new T.DodecahedronGeometry(1, 0)
    const batch = new T.InstancedMesh(rockGe, rockMat, rocks.length)
    this.scene.add(batch)
    for (const [i, r] of rocks.entries()) {
      dummy.position.set(r.x, r.y + 0.26 * r.s, r.z)
      dummy.rotation.set(0.13, r.ry, 0.27)
      dummy.scale.set(r.s * 1.31, r.s * 0.64, r.s * 0.92)
      dummy.updateMatrix()
      batch.setMatrixAt(i, dummy.matrix)
      shade.setScalar(0.64 + (i % 9) * 0.064)
      batch.setColorAt(i, shade)
    }
    batch.castShadow = true
    batch.receiveShadow = true
    batch.computeBoundingSphere()
    const poles = material('#535b54', 0.83, 0.38)
    const orange = material('#a15c3a', 1)
    this.flags = []
    for (const e of this.world.extras) {
      if (e.type === 'antenna') {
        box(this.scene, poles, 0.045, 4, 0.045, e.x, e.y + 1.9, e.z)
        box(this.scene, poles, 2.35, 0.045, 0.04, e.x, e.y + 2.2, e.z)
        box(this.scene, poles, 0.04, 0.045, 1.4, e.x, e.y + 3, e.z)
      }
      if (e.type === 'windsock') {
        box(this.scene, poles, 0.14, 6.2, 0.14, e.x, e.y + 3.09, e.z)
        const flag = new T.Group()
        flag.position.set(e.x, e.y + 6, e.z)
        this.scene.add(flag)
        const flagObj = mesh(
          new T.CylinderGeometry(0.16, 0.46, 2.4, 12, 1, true),
          orange,
          flag,
          1.2,
          -0.2,
          0,
        )
        flagObj.rotation.z = -1.67
        orange.side = T.DoubleSide
        this.flags.push(flag)
      }
    }
  }
  buildContactShadows() {
    const world = this.world
    const marks = world.vegetation
      .filter((o) => o.type === 'pine')
      .map((o) => [o.x, o.z, 2.9 * o.s, 2.4 * o.s])
    for (const b of world.extras.filter((e) => e.type === 'rock'))
      marks.push([b.x, b.z, b.s * 2.8, b.s * 2.1])
    for (const b of world.boxes)
      if (
        b.h > 1 &&
        b.w > 1.8 &&
        b.d > 1.5 &&
        Math.abs(world.height(b.x, b.z) - b.y) < 0.35
      )
        marks.push([b.x, b.z, b.w * 1.6, b.d * 1.5])
    const tex = canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31)
      g.addColorStop(0, '#13221dba')
      g.addColorStop(0.52, '#131c174b')
      g.addColorStop(1, '#131c1700')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 64, 64)
    })
    const geom = new T.PlaneGeometry(1, 1)
    geom.rotateX(-Math.PI / 2)
    const mat = new T.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      opacity: 0.63,
    })
    const shadows = new T.InstancedMesh(geom, mat, marks.length)
    shadows.renderOrder = 1
    for (const [i, [x, z, w, d]] of marks.entries()) {
      const ground = world.height(x, z)
      dummy.position.set(x, ground + 0.026, z)
      dummy.rotation.set(
        Math.atan2(world.height(x, z + 0.56) - ground, 0.56),
        0,
        Math.atan2(world.height(x + 0.56, z) - ground, 0.56),
      )
      // The horizontal plane's positive Z direction tilts down with positive X rotation.
      dummy.rotation.x *= -1
      dummy.scale.set(w, 1, d)
      dummy.updateMatrix()
      shadows.setMatrixAt(i, dummy.matrix)
    }
    shadows.computeBoundingSphere()
    this.scene.add(shadows)
  }
  sign(text, caption, x, z, y, w = 4.8, h = 1.05, yaw = 0, withPosts = true) {
    const board = material(
      '#365156',
      0.91,
      0,
      canvasTexture(512, 128, (ctx) => {
        ctx.fillStyle = '#1d3135'
        ctx.fillRect(0, 0, 512, 128)
        ctx.strokeStyle = '#8eb9b6'
        ctx.lineWidth = 3
        ctx.strokeRect(7, 7, 498, 114)
        ctx.fillStyle = '#c9dfd5'
        ctx.font = '800 45px "Barlow Condensed", sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(text, 256, 56)
        ctx.fillStyle = '#8fbdb4'
        ctx.font = '600 17px "IBM Plex Mono", monospace'
        ctx.fillText(caption, 256, 89)
      }),
    )
    board.color.set('#ffffff')
    const support = material('#414b49')
    const out = mesh(
      new T.PlaneGeometry(w, h),
      board,
      this.scene,
      x,
      y + 0.1,
      z,
    )
    out.receiveShadow = true
    out.rotation.y = yaw
    if (!withPosts) return
    for (const s of [-1, 1])
      box(
        this.scene,
        support,
        0.1,
        1.9,
        0.12,
        x + s * w * 0.39,
        y - 0.83,
        z - 0.06,
      )
  }
  buildMarks() {
    const w = this.world
    if (w.map.id === 'floodline' || w.map.id === 'relay-works') {
      for (const sign of w.extras.filter((e) => e.type === 'sector-sign'))
        this.sign(
          sign.name,
          `${w.map.chart}  /  ${w.map.sector}`,
          sign.x,
          sign.z,
          sign.y,
          sign.width,
          0.94,
          sign.yaw,
          false,
        )
      return
    }
    if (w.kind === 'range') {
      this.sign(
        'ECHO PROVING GROUND',
        'LIVE FIRE  /  LANES 01–03',
        -13.7,
        -10.5,
        w.height(-13.7, -10.5) + 2.04,
        6.15,
        1.46,
      )
      this.sign(
        'VAULT COURSE',
        'PARKOUR  /  LANES 04–06',
        15.5,
        1.7,
        w.height(15.5, 1.7) + 2.08,
        4.61,
        1.15,
      )
      this.sign(
        'SUPPLY / SERVICE',
        'ARMOR  ·  AMMUNITION',
        11.5,
        8.85,
        w.height(11.5, 8.85) + 1.82,
        3.7,
        0.88,
      )
    } else if (w.kind === 'yard')
      this.sign(
        'THE SWITCHYARD',
        'NDX FREIGHT / 04',
        -7,
        -27,
        w.height(-7, -27) + 2.26,
        5.1,
        1.1,
      )
    else
      for (const s of w.sites)
        this.sign(
          s.name,
          'VANTAGE RIDGE  /  SECTOR 07',
          s.x - 6,
          s.z + 4,
          w.height(s.x - 6, s.z + 4) + 2.19,
          5.1,
          1.1,
        )
  }
  buildWeather() {
    const geometry = new T.CylinderGeometry(1, 1, 1, 96, 1, true)
    this.gasMat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      uniforms: { time: { value: 0 }, cam: { value: new T.Vector3() } },
      vertexShader: `varying vec2 vUv;varying vec3 p;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);p=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: `varying vec2 vUv;varying vec3 p;uniform float time;uniform vec3 cam;
        void main(){float d=distance(cam,p),w=sin(p.x*.25+p.y*.23+time*.76)*sin(p.z*.22-time*.52);float burst=sin(p.z*.7+p.y*.15+time*.32);
        float a=(.23+w*.08+burst*.065)*(1.-smoothstep(.61,.99,vUv.y))*(.50+.5*smoothstep(1.,12.,d));
        gl_FragColor=vec4(.50+burst*.04,.59+burst*.04,.22,clamp(a,.0,.5));}`,
    })
    this.gasMesh = mesh(geometry, this.gasMat, this.scene)
    this.gasMesh.visible = false
    this.gasMesh.renderOrder = 4
    const max = QUALITY.high.particles
    const rand = randomSource(1238)
    this.drops = Array.from({ length: max }, () => [
      rand(),
      rand(),
      rand(),
      0.6 + rand() * 0.8,
    ])
    this.weatherGeo = new T.BufferGeometry()
    this.weatherGeo.setAttribute(
      'position',
      new T.BufferAttribute(new Float32Array(max * 6), 3).setUsage(
        T.DynamicDrawUsage,
      ),
    )
    this.weatherMat = new T.LineBasicMaterial({
      color: '#b3c9d4',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.rain = new T.LineSegments(this.weatherGeo, this.weatherMat)
    this.rain.frustumCulled = false
    this.scene.add(this.rain)
  }
  update(camera, snap, dt, weather, local) {
    const time = snap.time
    if (this.streetLights && (this.neonRelight ?? -1) <= time) {
      this.neonRelight = time + 0.45
      this.updateDistrictLights(camera.position.x, camera.position.z)
    }
    const want =
      weather === 'rain'
        ? 1
        : weather === 'clear'
          ? 0
          : this.world.kind === 'range'
            ? 0
            : 0.06 +
              0.9 *
                smooth(
                  0.07,
                  0.83,
                  Math.sin(
                    (time - 58) * 0.031 + (this.world.seed % 17) * 0.041,
                  ),
                )
    this.wet = lerp(this.wet, want, 1 - Math.exp(-dt * 1.35))
    this.skyMat.uniforms.uTime.value = time
    this.skyMat.uniforms.rain.value = this.wet
    this.sky.position.copy(camera.position)
    this.sky.scale.setScalar(
      Math.min(camera.far * 0.009, 0.9 + camera.far / 240),
    )
    const g = snap.gas
    let gas = 0
    if (g) {
      const d =
        Math.hypot(camera.position.x - g.x, camera.position.z - g.z) - g.r
      gas = camera.position.y < 170 ? smooth(-7, 25, d) : 0
      this.gasMesh.visible = g.state !== 'waiting' || g.stage > 1
      this.gasMesh.position.set(g.x, 95, g.z)
      this.gasMesh.scale.set(g.r, 237, g.r)
      this.gasMat.uniforms.cam.value.copy(camera.position)
      this.gasMat.uniforms.time.value = time
    } else this.gasMesh.visible = false
    const fog = this.scene.fog
    shade
      .set(this.fogTone)
      .lerp(new T.Color('#738d9a'), this.wet * 0.78)
      .lerp(new T.Color('#939f67'), gas * 0.66)
    fog.color.copy(shade)
    fog.density =
      (this.quality === 'low' ? 0.0045 : 0.00265) +
      this.wet * 0.0037 +
      gas * 0.022
    this.sun.intensity = (this.neon ? 1.94 : 2.61) - this.wet * 1.08
    this.hemi.intensity = (this.neon ? 2.22 : 2.13) + this.wet * 0.13
    if (this.sun.castShadow) {
      const x = Math.round(camera.position.x * 2) * 0.5,
        z = Math.round(camera.position.z * 2) * 0.5,
        y = local?.y ?? 3
      this.sun.position.set(x + 62, Math.min(99, y + 72), z - 62)
      this.sun.target.position.set(x, Math.min(30, y), z)
      this.sun.target.updateMatrixWorld()
    }
    for (const flag of this.flags) {
      flag.rotation.y = 0.84 + Math.sin(time * 1.4) * 0.16
      flag.rotation.z = Math.sin(time * 3.2) * 0.07
    }
    this.rain.visible = this.wet > 0.24 && camera.position.y < 149
    if (this.rain.visible) {
      this.weatherMat.opacity = this.wet * 0.36
      const data = this.weatherGeo.attributes.position,
        p = camera.position
      for (let i = 0; i < QUALITY[this.quality].particles; i++) {
        const [a, b, c, v] = this.drops[i]
        const x = p.x + (a - 0.5) * 51 + Math.sin(time * 0.27 + b) * 1.4,
          z = p.z + (c - 0.5) * 46
        const fall = (b * 18 - time * v * 12) % 18
        const y = p.y + (fall < 0 ? fall + 18 : fall) - 7.5
        data.setXYZ(i * 2, x, y, z)
        data.setXYZ(i * 2 + 1, x + 0.09 * v, y - 0.72 * v, z + 0.04)
      }
      data.needsUpdate = true
    }
  }
  dispose() {
    this.disposed = true
    for (const t of this.assetTextures) t.dispose()
  }
}
