import type { Point } from './county-data';
import { countyGeometry, MERIDIANS, ZONES_WEST_TO_EAST, type Area, type Zone } from './hours';

type MapSelection = { area: Area; zone: Zone; point?: Point };

export type DeviceLocation = { point: Point; accuracy: number };

type Projection = { left: number; top: number; scaleX: number; scale: number };

const mapBounds = { west: -93, east: -86.65, south: 42.35, north: 47.13 };
const longitudeScale = Math.cos((44.8 * Math.PI) / 180);
const metersPerDegree = 111_320;

const areaLabels = [
  ['Northern', [-90.7, 45.6]],
  ['Southern', [-89.9, 43.16]],
] as const;

export function isOnMap([x, y]: Point) {
  const { west, east, south, north } = mapBounds;

  return x >= west && x <= east && y >= south && y <= north;
}

export function setupZoneMap(
  canvas: HTMLCanvasElement,
  onPick: (point: Point, accuracy: number) => void,
): (selection: MapSelection | null, location: DeviceLocation | null, centered: boolean) => void {
  const ctx = canvas.getContext('2d');

  if (!ctx) return () => {};

  const styles = getComputedStyle(canvas);

  const land = {
    north: styles.getPropertyValue('--map-north').trim(),
    south: styles.getPropertyValue('--map-south').trim(),
  };

  const water = styles.getPropertyValue('--map-water').trim();
  const grid = styles.getPropertyValue('--map-grid').trim();
  const deviceColor = styles.getPropertyValue('--map-device').trim();
  const selectedColor = styles.getPropertyValue('--map-selected').trim();
  const navy = styles.getPropertyValue('--navy').trim();
  const muted = styles.getPropertyValue('--muted').trim();
  const primary = styles.getPropertyValue('--primary').trim();
  const surface = styles.getPropertyValue('--surface').trim();
  let projection: Projection | undefined;
  let active: MapSelection | null = null;
  let device: DeviceLocation | null = null;
  let centerOnDevice = false;

  const draw = () => {
    const { width, height } = canvas.getBoundingClientRect();

    if (width <= 32 || height <= 44) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;

    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const { west, east, south, north } = mapBounds;

    const fit = Math.min(
      (width - 32) / ((east - west) * longitudeScale),
      (height - 44) / (north - south),
    );

    const center = centerOnDevice ? device?.point : undefined;
    const [centerLon, centerLat] = center ?? [(west + east) / 2, (north + south) / 2];
    const scale = center ? fit * 1.65 : fit;
    const scaleX = scale * longitudeScale;
    const left = width / 2 - (centerLon - west) * scaleX;
    const top = (height - 26) / 2 - (north - centerLat) * scale;

    const project = ([x, y]: Point): Point => [
      left + (x - west) * scaleX,
      top + (north - y) * scale,
    ];

    projection = { left, top, scaleX, scale };

    ctx.fillStyle = water;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;

    for (let latitude = 42; latitude <= 48; latitude += 0.5) {
      const [, y] = project([west, latitude]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const zoneIndex = active ? ZONES_WEST_TO_EAST.indexOf(active.zone) : -1;
    const [zoneLeft] = project([MERIDIANS[zoneIndex - 1] ?? west, south]);
    const [zoneRight] = project([MERIDIANS[zoneIndex] ?? east, south]);

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

      if (active?.area === county.area) {
        ctx.save();
        ctx.clip('evenodd');
        ctx.fillStyle = primary;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(zoneLeft, 0, zoneRight - zoneLeft, height);
        ctx.restore();
      }

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
    const dot = device ? project(device.point) : null;

    for (const [label, point] of areaLabels) {
      const [x, y] = project(point);
      const labelWidth = ctx.measureText(label).width + 12;

      const overlapsMarker =
        marker && Math.abs(marker[0] - x) < labelWidth / 2 + 8 && Math.abs(marker[1] - y) < 18;

      const overlapsDot =
        dot && Math.abs(dot[0] - x) < labelWidth / 2 + 8 && Math.abs(dot[1] - y) < 18;

      const labelY = overlapsMarker || overlapsDot ? y - 26 : y;
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
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 8, y);
      ctx.lineTo(x, y + 8);
      ctx.lineTo(x - 8, y);
      ctx.closePath();
      ctx.fillStyle = selectedColor;
      ctx.strokeStyle = surface;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }

    if (device && dot) {
      const [x, y] = dot;

      // Project the reported radius at the map scale, with a minimum visible halo.
      const radius = Math.max(14, (device.accuracy / metersPerDegree) * scale);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = deviceColor;
      ctx.globalAlpha = 0.15;
      ctx.fill();
      ctx.strokeStyle = deviceColor;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.65;
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = deviceColor;
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

    onPick(coordinates, metersPerDegree / scale);
  });

  return (selection, location, centered) => {
    active = selection;
    device = location;
    centerOnDevice = centered;
    draw();
  };
}
