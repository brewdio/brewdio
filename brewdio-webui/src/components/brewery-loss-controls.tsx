import React, { useState } from 'react';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Check, X } from "lucide-react";
import type { CalculatedStage } from "@/components/brewery-visualization";
import type { EquipmentItemType } from "brewdio-wasm";
import { specificVolumeToGallonsPerKilogram, volumeToGallons } from "brewdio-wasm";
import { gallonsToUnit, type DisplayVolumeUnit } from "@/lib/volume-units";

// Export CalculatedStage type from brewery-visualization to avoid duplication
export type { CalculatedStage };

// Extend CalculatedStage to include equipment item and loss label
declare module "@/components/brewery-visualization" {
  interface CalculatedStage {
    lossLabel?: string;
    equipmentItem?: EquipmentItemType;
  }
}

interface BreweryLossControlsProps {
  stage: CalculatedStage | null;
  stageIndex: number;
  grainWeight: number;
  boilTime: number;
  onLossChange: (stageIndex: number, newLossValue: number) => void;
  onGrainAbsorptionChange?: (stageIndex: number, newRate: number) => void;
  onBoilRateChange?: (stageIndex: number, newRate: number) => void;
  onNameChange: (stageIndex: number, newName: string) => void;
  readOnly?: boolean;
  volumeUnit: DisplayVolumeUnit;
}

export const BreweryLossControls: React.FC<BreweryLossControlsProps> = ({
  stage,
  stageIndex,
  grainWeight,
  boilTime,
  onLossChange,
  onGrainAbsorptionChange,
  onBoilRateChange,
  onNameChange,
  readOnly = false,
  volumeUnit,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");

  const handleStartEditName = () => {
    if (stage && !readOnly) {
      setEditedName(stage.label);
      setIsEditingName(true);
    }
  };

  const handleSaveName = () => {
    if (editedName.trim()) {
      onNameChange(stageIndex, editedName.trim());
    }
    setIsEditingName(false);
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setEditedName("");
  };
  if (!stage || stage.isSource) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center text-muted-foreground">
            <p>Click on a stage in the visualization to view and adjust losses.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentLossValue = stage.equipmentItem
    ? volumeToGallons(stage.equipmentItem.loss)
    : 0;

  // Calculate individual loss contributions
  const grainAbsorptionRate = stage.equipmentItem?.grain_absorption_rate
    ? stage.equipmentItem.grain_absorption_rate.value
    : 0;
  const grainAbsorptionUnit = stage.equipmentItem?.grain_absorption_rate?.unit ?? "l/kg";
  const grainAbsorptionLossGallons = stage.equipmentItem?.grain_absorption_rate
    ? specificVolumeToGallonsPerKilogram(stage.equipmentItem.grain_absorption_rate) * grainWeight
    : 0;

  const boilRate = stage.equipmentItem?.boil_rate_per_hour
    ? volumeToGallons(stage.equipmentItem.boil_rate_per_hour)
    : 0;
  const boilLoss = boilRate * (boilTime / 60);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") handleCancelEditName();
                  }}
                  className="h-8 text-base font-semibold"
                  autoFocus
                />
                <Button
                  onClick={handleSaveName}
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  onClick={handleCancelEditName}
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{stage.label}</CardTitle>
                  <Button
                    onClick={handleStartEditName}
                    disabled={readOnly}
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 opacity-50 hover:opacity-100"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
                <CardDescription className="text-xs">
                  Total loss: {gallonsToUnit(stage.totalLoss, volumeUnit).toFixed(2)} {volumeUnit}
                </CardDescription>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Grain Absorption Rate Slider */}
          {stage.equipmentItem?.grain_absorption_rate && onGrainAbsorptionChange && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor={`grain-abs-${stage.id}`} className="text-sm">
                  Grain Absorption
                </Label>
                <span className="text-sm font-mono text-muted-foreground">
                  {grainAbsorptionRate.toFixed(2)} {grainAbsorptionUnit} ={" "}
                  {gallonsToUnit(grainAbsorptionLossGallons, volumeUnit).toFixed(2)} {volumeUnit}
                </span>
              </div>
              <Slider
                id={`grain-abs-${stage.id}`}
                min={0}
                max={2}
                step={0.05}
                value={[grainAbsorptionRate]}
                onValueChange={([value]) => onGrainAbsorptionChange(stageIndex, value)}
                disabled={readOnly}
                className="w-full"
              />
            </div>
          )}

          {/* Boil Rate Slider */}
          {stage.equipmentItem?.boil_rate_per_hour && onBoilRateChange && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor={`boil-rate-${stage.id}`} className="text-sm">
                  Boil Off Rate
                </Label>
                <span className="text-sm font-mono text-muted-foreground">
                  {gallonsToUnit(boilRate, volumeUnit).toFixed(2)} {volumeUnit}/hr ={" "}
                  {gallonsToUnit(boilLoss, volumeUnit).toFixed(2)} {volumeUnit}
                </span>
              </div>
              <Slider
                id={`boil-rate-${stage.id}`}
                min={0}
                max={3}
                step={0.1}
                value={[boilRate]}
                onValueChange={([value]) => onBoilRateChange(stageIndex, value)}
                disabled={readOnly}
                className="w-full"
              />
            </div>
          )}

          {/* Static Loss Slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor={`loss-${stage.id}`} className="text-sm">
                {stage.lossLabel || "Loss"}
              </Label>
              <span className="text-sm font-mono text-muted-foreground">
                {gallonsToUnit(currentLossValue, volumeUnit).toFixed(2)} {volumeUnit}
              </span>
            </div>
            <Slider
              id={`loss-${stage.id}`}
              min={0}
              max={2}
              step={0.05}
              value={[currentLossValue]}
              onValueChange={([value]) => onLossChange(stageIndex, value)}
              disabled={readOnly}
              className="w-full"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
