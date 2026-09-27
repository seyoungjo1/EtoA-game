plugins {
    id("com.android.application")
}

// 서명 키는 CI 가 환경변수로 넘긴다. 없으면 디버그 키로 서명한다.
val keystorePath: String? = System.getenv("KEYSTORE_FILE")

android {
    namespace = "app.etoa.gameboard"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.etoa.gameboard"
        minSdk = 24
        targetSdk = 34
        versionCode = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("APP_VERSION_NAME") ?: "1.0"
    }

    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release")
                            else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = false
    }
}

dependencies {
    implementation("androidx.core:core:1.13.1")
}
