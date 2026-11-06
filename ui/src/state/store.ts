import { create } from 'zustand';
import type { Horizon } from '@/data/types';

type SceneMode = 'underwater' | 'tank';
type Quality = 'high' | 'medium' | 'low';
type AppState = {
  scene: SceneMode;
  selectedCatchment: string;
  horizon: Horizon;
  scrollVelocity: number;
  quality: Quality;
  tankFraction: number; // current discharge, as a fraction of the on-screen waterline
  predictedFraction: number; // predicted discharge at the horizon
  showPredicted: boolean;
  setScene: (scene: SceneMode) => void;
  setSelectedCatchment: (id: string) => void;
  setHorizon: (horizon: Horizon) => void;
  setScrollVelocity: (velocity: number) => void;
  setQuality: (quality: Quality) => void;
  setTankLevels: (current: number, predicted: number, show: boolean) => void;
  setShowPredicted: (show: boolean) => void;
};

export const useAppStore = create<AppState>((set) => ({
  scene: 'underwater', selectedCatchment: 'camels_01047000', horizon: 7, scrollVelocity: 0, quality: 'high', tankFraction: 0.62, predictedFraction: 0.66, showPredicted: false,
  setScene: (scene) => set({ scene }), setSelectedCatchment: (selectedCatchment) => set({ selectedCatchment }),
  setHorizon: (horizon) => set({ horizon }), setScrollVelocity: (scrollVelocity) => set({ scrollVelocity }),
  setQuality: (quality) => set({ quality }),
  setTankLevels: (tankFraction, predictedFraction, showPredicted) => set({ tankFraction, predictedFraction, showPredicted }),
  setShowPredicted: (showPredicted) => set({ showPredicted }),
}));
