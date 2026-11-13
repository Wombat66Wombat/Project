import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GraphIndex, Note } from '../lib/types';
import { buildCity } from '../lib/city';
import { navigate, noteHref } from '../lib/router';

interface Props {
  notes: Note[];
  index: GraphIndex;
}

const css = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim() || '#888';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Your notes as a city: districts are groups of linked notes, buildings are notes (taller with
 * more links), roads are links, and recently edited notes light up. Orbit, zoom, hover, click.
 * A plain list of districts sits alongside for phones, screen readers, and browsers without WebGL.
 */
export default function CityView({ notes, index }: Props) {
  const city = useMemo(() => buildCity(notes, index), [notes, index]);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ title: string; links: number; x: number; y: number } | null>(null);
  const [labels, setLabels] = useState<{ name: string; x: number; y: number; visible: boolean }[]>([]);
  const has3d = useMemo(webglAvailable, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !has3d || city.buildings.length === 0) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
    const color = (name: string) => new THREE.Color(css(el, name));

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = color('--surface');
    scene.fog = new THREE.Fog(scene.background.getHex(), 120, 320);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1000);
    const span = Math.max(30, ...city.districts.map((d) => Math.max(Math.abs(d.x), Math.abs(d.z)) + d.half));
    camera.position.set(span * 1.1, span * 1.0, span * 1.3);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.minDistance = 8;
    controls.maxDistance = span * 4;

    scene.add(new THREE.HemisphereLight(dark ? 0x8899cc : 0xffffff, dark ? 0x111122 : 0xbbbbbb, dark ? 0.6 : 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, dark ? 0.35 : 1.2);
    sun.position.set(40, 80, 30);
    scene.add(sun);

    // Ground and district plots, coloured like the mind-map branches.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 6, span * 6), new THREE.MeshLambertMaterial({ color: color('--surface-2') }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    city.districts.forEach((d) => {
      const plot = new THREE.Mesh(
        new THREE.PlaneGeometry(d.half * 2 + 2, d.half * 2 + 2),
        new THREE.MeshLambertMaterial({ color: color(d.name === 'Outskirts' ? '--border' : `--b${d.id % 6}`), transparent: true, opacity: dark ? 0.35 : 0.22 }),
      );
      plot.rotation.x = -Math.PI / 2;
      plot.position.set(d.x, 0.02, d.z);
      scene.add(plot);
    });

    // Buildings: one instanced mesh for speed.
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const mesh = new THREE.InstancedMesh(geo, mat, city.buildings.length);
    const m = new THREE.Matrix4();
    const base = color('--surface');
    const lit = new THREE.Color(dark ? 0xffd27a : 0xfff1c2);
    city.buildings.forEach((b, i) => {
      m.compose(new THREE.Vector3(b.x, 0, b.z), new THREE.Quaternion(), new THREE.Vector3(b.size, b.height, b.size));
      mesh.setMatrixAt(i, m);
      const district = color(city.districts[b.district].name === 'Outskirts' ? '--muted' : `--b${b.district % 6}`);
      const c = base.clone().lerp(district, dark ? 0.55 : 0.45);
      // Recently edited notes glow warm (strongest at night).
      c.lerp(lit, b.glow * (dark ? 0.85 : 0.45));
      mesh.setColorAt(i, c);
    });
    scene.add(mesh);

    // Roads: links between buildings, just above the ground.
    const pos = new Map(city.buildings.map((b) => [b.id, b]));
    const pts: number[] = [];
    for (const [a, b] of city.roads) {
      const A = pos.get(a);
      const B = pos.get(b);
      if (A && B) pts.push(A.x, 0.06, A.z, B.x, 0.06, B.z);
    }
    const roads = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color: color('--muted'), transparent: true, opacity: 0.45 }),
    );
    scene.add(roads);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Hover and click via raycasting against the instanced buildings.
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered = -1;
    let down: { x: number; y: number } | null = null;
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObject(mesh)[0];
      return { id: hit?.instanceId ?? -1, x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const { id, x, y } = pick(e);
      if (id !== hovered) {
        hovered = id;
        renderer.domElement.style.cursor = id >= 0 ? 'pointer' : 'grab';
      }
      setHover(id >= 0 ? { title: city.buildings[id].title, links: city.buildings[id].links, x, y } : null);
    };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // a drag, not a click
      const { id } = pick(e);
      if (id >= 0) navigate(noteHref(city.buildings[id].id));
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', () => setHover(null));

    // District name labels follow the camera (HTML, so they stay crisp and readable).
    let frame = 0;
    let raf = 0;
    const v = new THREE.Vector3();
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      if (++frame % 6 === 0) {
        const w = el.clientWidth;
        const h = el.clientHeight;
        setLabels(
          city.districts.map((d) => {
            v.set(d.x, 2, d.z + d.half + 1.5).project(camera);
            return { name: d.name, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
          }),
        );
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        const obj = o as THREE.Mesh;
        obj.geometry?.dispose();
        const mt = obj.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
        else mt?.dispose();
      });
      renderer.domElement.remove();
    };
  }, [city, has3d]);

  const title = (id: string) => index.byId.get(id)?.title ?? '';

  return (
    <section className="city">
      <div className="graph-head">
        <h1>City</h1>
        <span className="muted small">
          {city.districts.length} districts · {city.buildings.length} buildings · drag to orbit, scroll to zoom, click a building to open it. Taller = more links; lit = edited recently.
        </span>
      </div>
      <div className="city-body">
        {has3d ? (
          <div className="city-canvas" ref={wrap} role="img" aria-label={`3D city of ${city.buildings.length} notes in ${city.districts.length} districts. The district list next to it has the same information.`}>
            {labels.map(
              (l, i) =>
                l.visible && (
                  <span key={i} className="city-label" style={{ left: l.x, top: l.y }}>
                    {l.name}
                  </span>
                ),
            )}
            {hover && (
              <div className="graph-tip city-tip" style={{ left: hover.x + 12, top: hover.y + 12, bottom: 'auto' }}>
                <strong>{hover.title}</strong>
                <br />
                <span className="muted">
                  {hover.links} link{hover.links === 1 ? '' : 's'}
                </span>
              </div>
            )}
            {city.buildings.length === 0 && <p className="graph-empty muted">No notes yet.</p>}
          </div>
        ) : (
          <p className="muted card">Your browser can’t show 3D graphics here, so the city is shown as a list.</p>
        )}
        <nav className="city-list" aria-label="Districts">
          <h2>Districts</h2>
          <ol>
            {city.districts.map((d) => (
              <li key={d.id}>
                <span className="swatch" style={{ background: d.name === 'Outskirts' ? 'var(--muted)' : `var(--b${d.id % 6})` }} aria-hidden="true" />
                <strong>{d.name}</strong> <span className="muted small">{d.count} note{d.count === 1 ? '' : 's'}</span>
                <ul>
                  {d.top.map((id) => (
                    <li key={id}>
                      <a href={noteHref(id)}>{title(id)}</a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </section>
  );
}
