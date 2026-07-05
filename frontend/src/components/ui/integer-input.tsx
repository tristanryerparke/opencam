import { memo } from "react";

import NumberInput, { type NumberInputProps } from "@/components/ui/number-input";

export interface IntegerInputProps
  extends Omit<NumberInputProps, "coerceValue" | "decimalScale"> {}

function coerceIntegerValue(value: number | undefined): number | undefined {
  return Number.isInteger(value) ? value : undefined;
}

export default memo(function IntegerInput(props: IntegerInputProps) {
  return (
    <NumberInput
      {...props}
      decimalScale={0}
      coerceValue={coerceIntegerValue}
    />
  );
});
