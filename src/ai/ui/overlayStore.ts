import { create } from 'zustand';
import type { AiOverlay, AnalysisReport } from '../types';

/** The AI analysis currently projected onto the main chart (toggle on the chart toolbar). */
interface OverlayState {
  visible: boolean;
  report: AnalysisReport | null;
  overlay: AiOverlay | null;
  show: (report: AnalysisReport) => void;
  setVisible: (v: boolean) => void;
}

export const useAiOverlay = create<OverlayState>((set) => ({
  visible: false,
  report: null,
  overlay: null,
  show: (report) => set({ report, overlay: report.overlay, visible: true }),
  setVisible: (visible) => set({ visible }),
}));
