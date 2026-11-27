plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    `maven-publish`
}

group = "com.github.benjbin"
version = "1.0.0"

android {
    namespace = "tech.pingsell.sdk"
    compileSdk = 35

    defaultConfig {
        minSdk = 21
        consumerProguardFiles("consumer-rules.pro")
        buildConfigField("String", "SDK_VERSION", "\"1.0.0\"")
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    publishing { singleVariant("release") { withSourcesJar() } }

    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    testImplementation("junit:junit:4.13.2")
}

// JitPack : implementation("com.github.benjbin:pingsell:<version>")
publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "com.github.benjbin"
            artifactId = "pingsell"
            version = project.version.toString()
            afterEvaluate { from(components["release"]) }
        }
    }
}
