import React from 'react';
import { gallonsToUnit, type DisplayVolumeUnit } from '@/lib/volume-units';

// --- Types ---

export type TankShape = 'rect' | 'dome' | 'chimney' | 'conical' | 'keg';

export interface CalculatedStage {
  id: string;
  label: string;
  shape: TankShape;
  volumeIn: number;
  volumeOut: number;
  totalLoss: number;
  isSource?: boolean;
}

interface BreweryVisualizationProps {
  stages: CalculatedStage[];
  beerColor: string;
  totalWaterNeeded: number;
  volumeUnit: DisplayVolumeUnit;
  selectedStageId?: string | null;
  onBeerColorChange?: (color: string) => void;
  onStageSelect?: (stageId: string) => void;
}

// --- Constants & Layout ---

const MAX_VISUAL_VOL = 15;
const TANK_WIDTH = 120;
const CYLINDER_HEIGHT = 133; // Scaled to 2/3 of original 200
const CONE_DROP = 47; // Scaled to 2/3 of original 70
const BASELINE_Y = 170; // Position where tanks sit
const LOSS_AREA_HEIGHT = 100; // Reserved space below tanks for loss visualization
const SVG_HEIGHT = 350; // Increased to accommodate labels at top and controls at bottom
const SVG_WIDTH = 1100;
const PX_PER_GAL = CYLINDER_HEIGHT / MAX_VISUAL_VOL;

// --- Shapes Logic (SVG Paths) ---

const getTankPath = (shape: TankShape, w: number, h: number): string => {
  switch (shape) {
    case 'dome': // Mash Tun
      return `M0,${h} V40 Q${w/2},0 ${w},40 V${h} Z`;

    case 'chimney': { // Kettle
      const neckW = w * 0.4;
      const neckX = (w - neckW) / 2;
      return `M0,${h} V40 H${neckX} V5 H${neckX + neckW} V40 H${w} V${h} Z`;
    }

    case 'conical': // Fermenter
      return `M0,0 H${w} V${h} L${w/2},${h + CONE_DROP} L0,${h} Z`;

    case 'keg': // Packaging
      return `
        M10,5
        Q0,5 0,15 V${h-15} Q0,${h-5} 10,${h-5}
        H${w-10}
        Q${w},${h-5} ${w},${h-15} V15 Q${w},5 ${w-10},5
        Z
        M10,5 V0 H${w-10} V5
        M10,${h-5} V${h} H${w-10} V${h-5}
      `;

    case 'rect': // Source Tank
    default:
      return `M0,0 H${w} V${h} H0 Z`;
  }
};

const BEER_COLORS = ['#F59E0B', '#D97706', '#92400E', '#78350F', '#000000'];

// --- Component ---

export const BreweryVisualization: React.FC<BreweryVisualizationProps> = ({
  stages,
  beerColor,
  totalWaterNeeded,
  volumeUnit,
  selectedStageId,
  onBeerColorChange,
  onStageSelect
}) => {
  // Find the maximum loss for normalization
  const maxLoss = Math.max(...stages.map(s => s.totalLoss), 0.1); // Min 0.1 to avoid division by zero

  return (
    <div className="relative bg-slate-800 rounded-lg p-4 border border-slate-700">
      {/* Color Picker - Bottom Left */}
      {onBeerColorChange && (
        <div className="absolute bottom-4 left-4 z-10 flex gap-1.5 bg-slate-900/80 backdrop-blur-sm p-2 rounded-lg border border-slate-600">
          {BEER_COLORS.map(c => (
            <button
              key={c}
              onClick={() => onBeerColorChange(c)}
              className={`w-5 h-5 rounded-full border-2 transition-all ${beerColor === c ? 'border-white scale-110' : 'border-slate-600 hover:border-slate-400'}`}
              style={{ backgroundColor: c }}
              title="Change beer color"
            />
          ))}
        </div>
      )}

      {/* Total Start Volume - Bottom Right */}
      <div className="absolute bottom-4 right-4 z-10">
        <div className="text-right">
          <div className="text-2xl font-black text-blue-400 tabular-nums">
            {gallonsToUnit(totalWaterNeeded, volumeUnit).toFixed(2)}{" "}
            <span className="text-sm text-slate-400">{volumeUnit}</span>
          </div>
          <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Total Start Volume</div>
        </div>
      </div>

      {/* Visualization */}
      <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="w-full h-auto">
        <defs>
          {/* Liquid Gradient */}
          <linearGradient id="liquidGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="white" stopOpacity="0.2" />
            <stop offset="25%" stopColor="white" stopOpacity="0.05" />
            <stop offset="50%" stopColor="white" stopOpacity="0" />
            <stop offset="75%" stopColor="black" stopOpacity="0.1" />
            <stop offset="100%" stopColor="black" stopOpacity="0.3" />
          </linearGradient>

          {/* Subtle Glow Filter for Selection */}
          <filter id="selectedGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
            <feOffset dx="0" dy="0" result="offsetblur" />
            <feFlood floodColor="#60A5FA" floodOpacity="0.5" />
            <feComposite in2="offsetblur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Clip Paths for Shapes */}
          {stages.map((stage) => (
            <clipPath key={`clip-${stage.id}`} id={`clip-${stage.id}`}>
              <path d={getTankPath(stage.shape, TANK_WIDTH, CYLINDER_HEIGHT)} />
            </clipPath>
          ))}
        </defs>

        {/* Render Loop */}
        {stages.map((stage, i) => {
          const xPos = 50 + (i * 200);
          const tankTopY = BASELINE_Y - CYLINDER_HEIGHT;

          // Visual Params
          const isConical = stage.shape === 'conical';
          const totalTankHeight = isConical ? CYLINDER_HEIGHT + CONE_DROP : CYLINDER_HEIGHT;

          // Calculate Liquid
          const rawHeight = stage.volumeIn * PX_PER_GAL;
          const maxVisualHeight = isConical ? CYLINDER_HEIGHT + CONE_DROP : CYLINDER_HEIGHT;
          const liquidHeight = isConical
            ? Math.max(0, Math.min(rawHeight * (totalTankHeight / CYLINDER_HEIGHT), maxVisualHeight))
            : Math.max(0, Math.min(rawHeight, maxVisualHeight));

          // Color Logic
          const liquidColor = stage.isSource ? "#3B82F6" : beerColor;
          const nextPipeColor = stage.isSource ? "#3B82F6" : beerColor;

          // Selection Logic
          const isSelected = selectedStageId === stage.id;
          const isClickable = !stage.isSource && onStageSelect;
          const tankOpacity = !selectedStageId || isSelected || stage.isSource ? 1 : 0.3;

          return (
            <g key={stage.id}>

              {/* PIPE to Next Tank */}
              {i < stages.length - 1 && (
                <g>
                  {/* Outer Pipe */}
                  <path
                    d={`M${xPos + TANK_WIDTH - 2},${BASELINE_Y - 20} H${xPos + TANK_WIDTH + 80}`}
                    stroke="#334155" strokeWidth="12" fill="none"
                  />
                  {/* Inner Liquid */}
                  <path
                    d={`M${xPos + TANK_WIDTH},${BASELINE_Y - 20} H${xPos + TANK_WIDTH + 80}`}
                    stroke={nextPipeColor} strokeWidth="6" strokeOpacity="0.6" fill="none" strokeDasharray="5 5"
                  >
                    <animate attributeName="stroke-dashoffset" from="10" to="0" dur="1s" repeatCount="indefinite" />
                  </path>
                </g>
              )}

              {/* TANK GROUP */}
              <g
                transform={`translate(${xPos}, ${tankTopY})`}
                style={{
                  opacity: tankOpacity,
                  cursor: isClickable ? 'pointer' : 'default',
                  transition: 'opacity 0.3s ease'
                }}
                onClick={() => isClickable && onStageSelect(stage.id)}
              >

                {/* 1. Tank Shell (Glass) */}
                <path
                  d={getTankPath(stage.shape, TANK_WIDTH, CYLINDER_HEIGHT)}
                  fill="#1e293b"
                  fillOpacity="0.5"
                  stroke="#475569"
                  strokeWidth="3"
                  filter={isSelected ? "url(#selectedGlow)" : undefined}
                  style={{ transition: 'filter 0.3s ease' }}
                />

                {/* 2. Liquid (Clipped) */}
                <g clipPath={`url(#clip-${stage.id})`}>
                  <rect
                    x="0"
                    y={isConical ? (CYLINDER_HEIGHT + CONE_DROP - liquidHeight) : (CYLINDER_HEIGHT - liquidHeight)}
                    width={TANK_WIDTH}
                    height={liquidHeight + 20}
                    fill={liquidColor}
                    className="transition-all duration-700 ease-out"
                  />
                  <rect
                    x="0"
                    y={isConical ? (CYLINDER_HEIGHT + CONE_DROP - liquidHeight) : (CYLINDER_HEIGHT - liquidHeight)}
                    width={TANK_WIDTH}
                    height={liquidHeight + 20}
                    fill="url(#liquidGradient)"
                    style={{ mixBlendMode: 'overlay' }}
                  />
                  {/* Meniscus Line */}
                  <path
                    d={`M0,${isConical ? (CYLINDER_HEIGHT + CONE_DROP - liquidHeight) : (CYLINDER_HEIGHT - liquidHeight)} H${TANK_WIDTH}`}
                    stroke="white" strokeWidth="2" strokeOpacity="0.4"
                  />
                </g>

                {/* 3. Labels */}
                <text x={TANK_WIDTH/2} y="-15" textAnchor="middle" fill="#94a3b8" fontSize="12" fontWeight="bold" letterSpacing="1px">
                  {stage.label.toUpperCase()}
                </text>

                {/* Volume text */}
                <text x={TANK_WIDTH/2} y={CYLINDER_HEIGHT/2} textAnchor="middle" fill="white" fontSize="18" fontWeight="800" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
                  {gallonsToUnit(stage.volumeIn, volumeUnit).toFixed(2)} {volumeUnit}
                </text>
              </g>

              {/* LOSS DRAINS (Bottom of Tank) */}
              {stage.totalLoss > 0 && (() => {
                // Normalize loss height to fit within reserved area
                const normalizedHeight = (stage.totalLoss / maxLoss) * (LOSS_AREA_HEIGHT * 0.7); // Use 70% of reserved area
                const pipeLength = 10;

                return (
                  <g className="transition-all duration-500 ease-out">
                    <g transform={`translate(${xPos + (TANK_WIDTH/2)}, ${isConical ? BASELINE_Y + CONE_DROP : BASELINE_Y})`}>

                      {/* Vertical Drop Pipe */}
                      <rect x="-4" y="0" width="8" height={pipeLength} fill="#334155" />

                      {/* The Loss Stream */}
                      <rect
                        x="-3" y={pipeLength}
                        width="6"
                        height={normalizedHeight}
                        fill={liquidColor}
                        opacity="0.7"
                        rx="3"
                      />

                      {/* Text Label */}
                      <text
                        x="0"
                        y={pipeLength + normalizedHeight + 12}
                        textAnchor="middle"
                        fill="#ef4444"
                        fontSize="10"
                        fontWeight="bold"
                      >
                        -{gallonsToUnit(stage.totalLoss, volumeUnit).toFixed(2)} {volumeUnit}
                      </text>
                    </g>
                  </g>
                );
              })()}

            </g>
          );
        })}
      </svg>
    </div>
  );
};
