'use client';

import React from 'react';
import PerformanceDashboard from './PerformanceDashboard';

const PerformancePage: React.FC = () => {
  return (
    <div className="animate-page-enter">
      <PerformanceDashboard />
    </div>
  );
};

export default PerformancePage;
