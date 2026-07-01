package uz.fbwarehouse.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dagger.hilt.android.AndroidEntryPoint
import uz.fbwarehouse.android.navigation.AppRoot
import uz.fbwarehouse.android.ui.theme.WmsNativeTheme

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            WmsNativeTheme {
                AppRoot()
            }
        }
    }
}
