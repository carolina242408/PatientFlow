import { useTranslation } from 'react-i18next'
import { OperationPopup } from './OperationPopup'

type AccessWarningKind = 'missingApplicationRole' | 'missingManagerScope'

export const AccessWarning = ({ kind }: { kind: AccessWarningKind }) => {
  const { t } = useTranslation()

  return (
    <OperationPopup
      type="error"
      title={t(`access.${kind}Title`)}
      description={t(`access.${kind}Description`)}
      persistent
    />
  )
}
