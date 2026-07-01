package uz.fbwarehouse.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
    primary = AccentBlue,
    onPrimary = SlateSurface,
    background = SlateBackground,
    surface = SlateSurface,
    onBackground = SlateTextPrimary,
    onSurface = SlateTextPrimary,
    error = RoseError,
    outline = SlateBorder,
)

private val DarkColors = darkColorScheme(
    primary = AccentBlue,
    onPrimary = SlateSurface,
    error = RoseError,
)

@Composable
fun WmsNativeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colorScheme,
        typography = WmsTypography,
        content = content,
    )
}
