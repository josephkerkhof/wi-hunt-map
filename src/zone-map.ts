import type { Point } from './county-data';
import { countyGeometry, MERIDIANS, ZONES_WEST_TO_EAST, type Zone } from './hours';

type MapSelection = { zone: Zone; point?: Point };

type Projection = { left: number; top: number; scaleX: number; scale: number };

const mapBounds = { west: -93, east: -86.65, south: 42.35, north: 47.13 };
const longitudeScale = Math.cos((44.8 * Math.PI) / 180);

const areaLabels = [
  ['Northern', [-90.7, 45.6]],
  ['Southern', [-89.9, 43.16]],
] as const;

export function setupZoneMap(
  canvas: HTMLCanvasElement,
  onPick: (point: Point, accuracy: number) => void,
): (selection: MapSelection | null) => void {
  const ctx = canvas.getContext('2d');

  if (!ctx) return () => {};

  const styles = getComputedStyle(canvas);

  const land = {
    north: styles.getPropertyValue('--map-north').trim(),
    south: styles.getPropertyValue('--map-south').trim(),
  };

  const water = styles.getPropertyValue('--intro').trim();
  const grid = styles.getPropertyValue('--line').trim();
  const navy = styles.getPropertyValue('--navy').trim();
  const muted = styles.getPropertyValue('--muted').trim();
  const primary = styles.getPropertyValue('--primary').trim();
  const surface = styles.getPropertyValue('--surface').trim();
  let projection: Projection | undefined;
  let active: MapSelection | null = null;

  const draw = () => {
    const { width, height } = canvas.getBoundingClientRect();

    if (width === 0 || height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const { west, east, south, north } = mapBounds;

    const scale = Math.min(
      (width - 15) / ((east - west) * longitudeScale),
      (height - 33) / (north - south),
    );

    const scaleX = scale * longitudeScale;
    const left = (width - (east - west) * scaleX) / 2;
    const top = (height - (north - south) * scale - 17) / 2;

    const project = ([x, y]: Point): Point => [
      left + (x - west) * scaleX,
      top + (north - y) * scale,
    ];

    projection = { left, top, scaleX, scale };

    ctx.fillStyle = water;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;

    for (let i = 1; i < 5; i += 1) {
      const y = (height * i) / 5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    for (const county of countyGeometry) {
      ctx.beginPath();

      for (const polygon of county.polygons) {
        for (const ring of polygon) {
          ctx.moveTo(...project(ring[0]));

          for (const point of ring.slice(1)) ctx.lineTo(...project(point));
          ctx.closePath();
        }
      }

      ctx.fillStyle = land[county.area];
      ctx.fill('evenodd');
      ctx.strokeStyle = muted;
      ctx.lineWidth = 0.65;
      ctx.stroke();
    }

    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;

    for (const boundary of MERIDIANS) {
      const [x] = project([boundary, 0]);
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x, height - 24);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const marker = active?.point ? project(active.point) : null;

    for (const [label, point] of areaLabels) {
      const [x, y] = project(point);
      const labelWidth = ctx.measureText(label).width + 12;

      const overlapsMarker =
        marker && Math.abs(marker[0] - x) < labelWidth / 2 + 8 && Math.abs(marker[1] - y) < 18;

      const labelY = overlapsMarker ? y - 26 : y;
      ctx.fillStyle = surface;
      ctx.fillRect(x - labelWidth / 2, labelY - 10, labelWidth, 20);
      ctx.fillStyle = navy;
      ctx.fillText(label, x, labelY);
    }

    for (const [i, letter] of ZONES_WEST_TO_EAST.entries()) {
      const [x] = project([-92.5 + i, 0]);
      const selected = active?.zone === letter;
      ctx.fillStyle = selected ? primary : surface;
      ctx.beginPath();
      ctx.arc(x, height - 14, 10, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = selected ? surface : navy;
      ctx.fillText(letter, x, height - 14);
    }

    if (marker) {
      const [x, y] = marker;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, 2 * Math.PI);
      ctx.fillStyle = primary;
      ctx.strokeStyle = surface;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  };

  new ResizeObserver(draw).observe(canvas);
  canvas.addEventListener('click', event => {
    if (!projection) return;
    const { left, top, scaleX, scale } = projection;
    const bounds = canvas.getBoundingClientRect();

    const coordinates: Point = [
      mapBounds.west + (event.clientX - bounds.left - left) / scaleX,
      mapBounds.north - (event.clientY - bounds.top - top) / scale,
    ];

    onPick(coordinates, (111_320 / scale) * 2);
  });

  return selection => {
    active = selection;
    draw();
  };
}
