import { createSignal, onMount, onCleanup, Accessor, createEffect } from "solid-js";
import { Line } from "solid-chartjs";
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  CategoryScale,
  Filler,
  Chart,
} from "chart.js";
import "./WeightForAgeChart.css";

interface WeightForAgeChartProps {
  height: Accessor<number>;
  setHeight: (value: number) => void;
  weight: Accessor<number>;
  setWeight: (value: number) => void;
  ageGroup: Accessor<string>;
  setAgeGroup: (value: string) => void;
}

const WeightForAgeChart = (props: WeightForAgeChartProps) => {
  const { weight, setWeight, ageGroup, setAgeGroup } = props;

  // Initialize age based on age group
  const getInitialAge = () => {
    const ag = ageGroup();
    if (ag === "child") return 10;
    if (ag === "teen") return 16;
    return 30;
  };

  const [age, setAge] = createSignal(getInitialAge());
  let canvasRef: HTMLCanvasElement | undefined;

  let chartRef: HTMLDivElement | undefined;
  const [isDragging, setIsDragging] = createSignal(false);
  const [dotPosition, setDotPosition] = createSignal({ left: "0px", top: "0px" });
  const [editingField, setEditingField] = createSignal<"age" | null>(null);
  const [tempValue, setTempValue] = createSignal("");

  // Get the Chart.js instance from the canvas
  const getChartInstance = (): Chart | null => {
    if (!canvasRef) return null;
    return ChartJS.getChart(canvasRef) || null;
  };

  // Removed the sync effect - age is controlled by user interaction
  // The mouse handlers and sliders update ageGroup based on age

  const startEditingAge = () => {
    setTempValue(age().toFixed(0));
    setEditingField("age");
  };

  const commitEdit = () => {
    const field = editingField();
    const value = parseFloat(tempValue());

    if (!isNaN(value) && field === "age") {
      const newAge = Math.max(minAge, Math.min(maxAge, value));
      setAge(newAge);
      if (newAge < 13) {
        setAgeGroup("child");
      } else if (newAge < 20) {
        setAgeGroup("teen");
      } else {
        setAgeGroup("adult");
      }
    }

    setEditingField(null);
    setTempValue("");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setTempValue("");
  };

  const minAge = 4;
  const maxAge = 100;
  const minWeight = 10;
  const maxWeight = 200;

  ChartJS.register(
    Title,
    Tooltip,
    Legend,
    LineElement,
    LinearScale,
    PointElement,
    CategoryScale,
    Filler
  );

  // Track when chart is fully ready
  const [chartReady, setChartReady] = createSignal(false);

  // Check if chart is ready - poll every 100ms until ready
  onMount(() => {
    const checkInterval = setInterval(() => {
      const c = getChartInstance();

      if (c && c.scales && c.scales.x && c.scales.y) {
        setChartReady(true);
        clearInterval(checkInterval);
      }
    }, 100);

    onCleanup(() => clearInterval(checkInterval));
  });

  const getPercentileData = (percentile: number) => {
    const data = [];
    const percentileFactor = percentile / 50; // Normalize around 50th percentile

    for (let agePoint = minAge; agePoint <= maxAge; agePoint++) {
      let w;

      if (agePoint <= 13) {
        // Child: rapid growth phase (4-13 years)
        // Base weights: 15kg at age 4, 40kg at age 13
        const baseWeight = 15 + (agePoint - 4) * 2.8;
        w = baseWeight * (0.85 + 0.3 * (percentileFactor - 1));
      } else if (agePoint <= 18) {
        // Teen: adolescent growth spurt (13-18 years)
        // Base weights: 40kg at age 13, 65kg at age 18
        const baseWeight = 40 + (agePoint - 13) * 5;
        w = baseWeight * (0.85 + 0.3 * (percentileFactor - 1));
      } else if (agePoint <= 30) {
        // Young adult: plateau (18-30 years)
        // Base weight: 65-70kg
        const baseWeight = 65 + (agePoint - 18) * 0.4;
        w = baseWeight * (0.85 + 0.35 * (percentileFactor - 1));
      } else {
        // Adult: gradual weight increase (30-100 years)
        const baseWeight = 70 + (agePoint - 30) * 0.15;
        w = baseWeight * (0.85 + 0.35 * (percentileFactor - 1));
      }

      // Clamp to reasonable bounds
      w = Math.max(minWeight, Math.min(maxWeight, w));
      data.push({ x: agePoint, y: w });
    }
    return data;
  };

  const chartData = {
    datasets: [
      {
        label: "Healthy Range (lower)",
        data: getPercentileData(25),
        borderColor: "#888888",
        borderWidth: 1.5,
        pointRadius: 0,
        fill: "+1",
      },
      {
        label: "Healthy Range (upper)",
        data: getPercentileData(85),
        borderColor: "#888888",
        borderWidth: 1.5,
        backgroundColor: "rgba(136, 136, 136, 0.15)",
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: "linear" as const,
        min: minAge,
        max: maxAge,
        title: {
          display: true,
          text: "Age (years)",
          color: "#888888",
          font: {
            size: 11,
            weight: 400,
          },
        },
        ticks: {
          color: "#888888",
          font: {
            size: 10,
          },
        },
        grid: {
          color: "#2f2f2f",
          lineWidth: 1,
        },
      },
      y: {
        min: minWeight,
        max: maxWeight,
        title: {
          display: true,
          text: "Weight (kg)",
          color: "#888888",
          font: {
            size: 11,
            weight: 400,
          },
        },
        ticks: {
          color: "#888888",
          font: {
            size: 10,
          },
        },
        grid: {
          color: "#2f2f2f",
          lineWidth: 1,
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      filler: {
        propagate: true,
      },
    },
    animation: {
      onComplete: () => {
        const c = getChartInstance();
        if (c && c.scales && c.scales.x && c.scales.y) {
          setChartReady(true);
        }
      },
    },
  };

  const handleMouseMove = (e: MouseEvent) => {
    const c = getChartInstance();
    if (!isDragging() || !c || !c.scales || !c.scales.x || !c.scales.y) return;
    const canvas = c.canvas;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newAge = c.scales.x.getValueForPixel(x) ?? age();
    const newWeight = c.scales.y.getValueForPixel(y) ?? weight();

    setAge(Math.max(minAge, Math.min(maxAge, newAge)));
    setWeight(Math.max(minWeight, Math.min(maxWeight, newWeight)));

    if (newAge < 13) {
      setAgeGroup("child");
    } else if (newAge < 20) {
      setAgeGroup("teen");
    } else {
      setAgeGroup("adult");
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseDown = (e: MouseEvent) => {
    const c = getChartInstance();
    if (!c || !c.scales || !c.scales.x || !c.scales.y) {
      return;
    }

    setIsDragging(true);

    // Immediately update position on click
    const canvas = c.canvas;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newAge = c.scales.x.getValueForPixel(x) ?? age();
    const newWeight = c.scales.y.getValueForPixel(y) ?? weight();

    setAge(Math.max(minAge, Math.min(maxAge, newAge)));
    setWeight(Math.max(minWeight, Math.min(maxWeight, newWeight)));

    if (newAge < 13) {
      setAgeGroup("child");
    } else if (newAge < 20) {
      setAgeGroup("teen");
    } else {
      setAgeGroup("adult");
    }
  };

  onMount(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  });

  onCleanup(() => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  });

  // Update dot position whenever age, weight, or chartReady changes
  createEffect(() => {
    const c = getChartInstance();
    const currentAge = age();
    const currentWeight = weight();
    const ready = chartReady();

    if (!ready || !c || !c.scales || !c.scales.x || !c.scales.y) {
      return;
    }

    try {
      const x = c.scales.x.getPixelForValue(currentAge);
      const y = c.scales.y.getPixelForValue(currentWeight);

      // Get canvas offset relative to container
      const canvas = c.canvas;
      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = chartRef?.getBoundingClientRect();

      if (containerRect) {
        const offsetX = canvasRect.left - containerRect.left;
        const offsetY = canvasRect.top - containerRect.top;

        const finalLeft = offsetX + x;
        const finalTop = offsetY + y;

        setDotPosition({
          left: `${finalLeft}px`,
          top: `${finalTop}px`
        });
      }
    } catch (error) {
      console.error("Error positioning dot:", error);
    }
  });

  return (
    <div class="property-group">
      <div
        ref={chartRef}
        class={`chart-container ${isDragging() ? "dragging" : ""}`}
      >
        <Line
          data={chartData}
          options={chartOptions}
          ref={canvasRef}
        />
        <div class="chart-overlay" onMouseDown={handleMouseDown} />
        <div class="chart-dot" style={dotPosition()} />
      </div>
      <div class="property-group">
        <div class="property-label-row">
          <label>Age</label>
          {editingField() === "age" ? (
            <input
              type="number"
              class="property-value-input"
              value={tempValue()}
              onInput={(e) => setTempValue(e.currentTarget.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                else if (e.key === "Escape") cancelEdit();
              }}
              ref={(el) => {
                setTimeout(() => {
                  el.focus();
                  el.select();
                }, 0);
              }}
            />
          ) : (
            <span class="property-value editable" onClick={startEditingAge}>
              {age().toFixed(0)} years
            </span>
          )}
        </div>
        <input
          type="range"
          min={minAge}
          max={maxAge}
          step="1"
          value={age()}
          onInput={(e) => {
            const newAge = parseFloat(e.currentTarget.value);
            setAge(newAge);
            if (newAge < 13) {
              setAgeGroup("child");
            } else if (newAge < 20) {
              setAgeGroup("teen");
            } else {
              setAgeGroup("adult");
            }
          }}
          class="property-slider"
        />
      </div>
    </div>
  );
};

export default WeightForAgeChart;
