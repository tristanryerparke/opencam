type AddOperationButtonProps = {
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
};

export function AddOperationButton({ className, disabled, onClick }: AddOperationButtonProps) {
  return <button type="button" data-slot="opencam-add-operation-button" className={`opencam-add-operation-button ${className ?? ""}`} disabled={disabled} onClick={onClick}>Add Operation</button>;
}
