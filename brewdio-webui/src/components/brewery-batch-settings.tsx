import React from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DisplayVolumeUnit } from "@/lib/volume-units";

interface BreweryBatchSettingsProps {
  targetVolume: number;
  boilTime: number;
  grainWeight: number;
  volumeUnit: DisplayVolumeUnit;
  onTargetVolumeChange: (value: number) => void;
  onBoilTimeChange: (value: number) => void;
  onGrainWeightChange: (value: number) => void;
}

export const BreweryBatchSettings: React.FC<BreweryBatchSettingsProps> = ({
  targetVolume,
  boilTime,
  grainWeight,
  volumeUnit,
  onTargetVolumeChange,
  onBoilTimeChange,
  onGrainWeightChange
}) => {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("brewery.batchSettings")}</CardTitle>
        <CardDescription>{t("brewery.batchSettingsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="target-volume">{t("brewery.packagingTarget")}</Label>
            <div className="relative">
              <Input
                id="target-volume"
                type="number"
                value={targetVolume}
                onChange={(e) => onTargetVolumeChange(Number(e.target.value))}
                step="0.1"
                min="0"
                className="pr-12"
              />
              <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">{volumeUnit}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="boil-time">{t("brewery.boilTime")}</Label>
            <div className="relative">
              <Input
                id="boil-time"
                type="number"
                value={boilTime}
                onChange={(e) => onBoilTimeChange(Number(e.target.value))}
                step="5"
                min="0"
                className="pr-12"
              />
              <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">min</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="grain-weight">{t("brewery.grainWeight")}</Label>
            <div className="relative">
              <Input
                id="grain-weight"
                type="number"
                value={grainWeight}
                onChange={(e) => onGrainWeightChange(Number(e.target.value))}
                step="0.1"
                min="0"
                className="pr-12"
              />
              <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">kg</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
