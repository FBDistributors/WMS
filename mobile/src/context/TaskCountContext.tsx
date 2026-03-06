/**
 * PickerHome dan buyurtmalar soni — footer badge uchun.
 */
import React, { createContext, useContext, useState } from 'react';

type TaskCountContextValue = {
  taskCount: number;
  setTaskCount: (n: number) => void;
};

const TaskCountContext = createContext<TaskCountContextValue | null>(null);

export function TaskCountProvider({ children }: { children: React.ReactNode }) {
  const [taskCount, setTaskCount] = useState(0);
  return (
    <TaskCountContext.Provider value={{ taskCount, setTaskCount }}>
      {children}
    </TaskCountContext.Provider>
  );
}

export function useTaskCount(): TaskCountContextValue {
  const ctx = useContext(TaskCountContext);
  if (!ctx) return { taskCount: 0, setTaskCount: () => {} };
  return ctx;
}
