import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ScrollView, Text, View } from 'react-native'

// The settings panel for {{PKG_NAME}}. Mounted by core inside
// /a/settings/{{PKG_SLUG}}/{{PKG_SLUG}} via the manifest's
// `settings[]` entry. This is the only screen the package contributes.

export default function {{PKG_PASCAL}}Settings() {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')

    return (
        <ScrollView className="flex-1 bg-background">
            <View className="p-6 gap-3">
                <Text style={{ color: fg, fontSize: 22, fontWeight: '600' }}>{{PKG_NAME}}</Text>
                <Text style={{ color: muted, fontSize: 14 }}>{{PKG_DESCRIPTION}}</Text>
            </View>
        </ScrollView>
    )
}
